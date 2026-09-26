"""The AI models of the furnuture server. Loaded once, on first use (or at start-up)."""

import threading
import uuid
from collections import OrderedDict

import numpy as np
from PIL import Image

SEG_MODEL = "nvidia/segformer-b5-finetuned-ade-640-640"
SAM_MODEL = "facebook/sam-vit-base"
CLIP_MODEL = "openai/clip-vit-base-patch16"
RMBG_MODEL = "briaai/RMBG-1.4"
LAMA_REPO, LAMA_FILE = "Carve/LaMa-ONNX", "lama_fp32.onnx"

_lock = threading.Lock()  # sessions
_loaded: dict = {}
_loading: dict[str, threading.Lock] = {}


def _get(name, load):
    """The model `name`, loaded once. One lock per model: loading one never blocks another."""
    with _lock:
        guard = _loading.setdefault(name, threading.Lock())
    with guard:
        if name not in _loaded:
            _loaded[name] = load()
        return _loaded[name]


def loaded() -> list[str]:
    return sorted(_loaded)


def _torch():
    import torch

    return torch


# --- Room recognition ---------------------------------------------------------


def _seg():
    from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

    return SegformerImageProcessor.from_pretrained(SEG_MODEL), SegformerForSemanticSegmentation.from_pretrained(SEG_MODEL).eval()


def segment(img: Image.Image, out_w: int, out_h: int):
    """ADE20K class per pixel at out_w × out_h, plus the class names."""
    torch = _torch()
    proc, model = _get("segment", _seg)
    with torch.inference_mode():
        logits = model(**proc(images=img.convert("RGB"), return_tensors="pt")).logits
        up = torch.nn.functional.interpolate(logits, size=(out_h, out_w), mode="bilinear", align_corners=False)
        class_map = up.argmax(1)[0].to(torch.uint8).numpy()
    id2label = {int(k): v for k, v in model.config.id2label.items()}
    return class_map, id2label, SEG_MODEL


# --- Sorting photos per room ----------------------------------------------------


def classify(images: list[Image.Image], labels: list[str]) -> list[str]:
    from transformers import pipeline

    clf = _get("classify", lambda: pipeline("zero-shot-image-classification", model=CLIP_MODEL))
    return [clf(im.convert("RGB"), candidate_labels=labels, hypothesis_template="a photo of {}")[0]["label"] for im in images]


# --- Product photo cut-out ------------------------------------------------------


def remove_background(img: Image.Image) -> Image.Image:
    from transformers import pipeline

    pipe = _get("removeBackground", lambda: pipeline("image-segmentation", model=RMBG_MODEL, trust_remote_code=True))
    mask = pipe(img.convert("RGB"), return_mask=True)
    if not isinstance(mask, Image.Image):
        mask = Image.fromarray(np.asarray(mask))
    out = img.convert("RGBA")
    out.putalpha(mask.convert("L").resize(img.size))
    return out


# --- Erasing (LaMa) ------------------------------------------------------------------


def _lama():
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download

    return ort.InferenceSession(hf_hub_download(LAMA_REPO, LAMA_FILE), providers=["CPUExecutionProvider"])


def inpaint(img: Image.Image, mask: Image.Image) -> Image.Image:
    """Fills the white part of `mask`. The model works at 512 × 512; the result is scaled back."""
    sess = _get("inpaint", _lama)
    w, h = img.size
    rgb = img.convert("RGB")
    remove = mask.convert("L").resize((w, h), Image.NEAREST).point(lambda v: 255 if v > 127 else 0)
    a = np.asarray(rgb.resize((512, 512), Image.BICUBIC), dtype=np.float32) / 255.0
    m = (np.asarray(remove.resize((512, 512), Image.BILINEAR)) > 0).astype(np.float32)
    names = [i.name for i in sess.get_inputs()]
    mask_name = "mask" if "mask" in names else names[1]
    image_name = next(n for n in names if n != mask_name)
    out = sess.run(None, {image_name: a.transpose(2, 0, 1)[None], mask_name: m[None, None]})[0][0]
    if out.max() <= 1.5:
        out = out * 255.0
    filled = Image.fromarray(np.clip(out.transpose(1, 2, 0), 0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return Image.composite(filled, rgb, remove)


# --- Tap-to-select (SAM) ---------------------------------------------------------------

_sessions: "OrderedDict[str, dict]" = OrderedDict()
MAX_SESSIONS = 8


def _sam():
    from transformers import SamModel, SamProcessor

    return SamProcessor.from_pretrained(SAM_MODEL), SamModel.from_pretrained(SAM_MODEL).eval()


def sam_embed(img: Image.Image) -> str:
    """Analyses a photo once; taps on it then only run the small mask decoder."""
    torch = _torch()
    proc, model = _get("sam", _sam)
    inputs = proc(images=img.convert("RGB"), return_tensors="pt")
    with torch.inference_mode():
        emb = model.get_image_embeddings(inputs["pixel_values"])
    sid = uuid.uuid4().hex
    with _lock:
        _sessions[sid] = {
            "emb": emb,
            "original_sizes": inputs["original_sizes"],
            "reshaped_input_sizes": inputs["reshaped_input_sizes"],
        }
        while len(_sessions) > MAX_SESSIONS:
            _sessions.popitem(last=False)
    return sid


def sam_mask(sid: str, points, labels, out_w: int, out_h: int):
    """Mask (out_w × out_h, 1 byte per pixel) of the object at the points (pixels of the analysed photo)."""
    torch = _torch()
    with _lock:
        s = _sessions.get(sid)
        if s is not None:
            _sessions.move_to_end(sid)
    if s is None:
        raise KeyError(sid)
    proc, model = _get("sam", _sam)
    oh, ow = [int(v) for v in s["original_sizes"][0]]
    rh, rw = [int(v) for v in s["reshaped_input_sizes"][0]]
    pts = torch.tensor([[[[x * rw / ow, y * rh / oh] for x, y in points]]], dtype=torch.float32)
    lbl = torch.tensor([[labels]], dtype=torch.int64)
    with torch.inference_mode():
        out = model(image_embeddings=s["emb"], input_points=pts, input_labels=lbl, multimask_output=True)
        masks = proc.image_processor.post_process_masks(
            out.pred_masks, s["original_sizes"], s["reshaped_input_sizes"], binarize=False
        )[0][0]  # (3, H, W) logits at photo size
        scores = out.iou_scores[0, 0]
        # SAM offers a part, a bigger part and the whole object; take the largest of the good ones.
        good = [i for i in range(len(scores)) if scores[i] >= scores.max() * 0.85]
        best = max(good, key=lambda i: int((masks[i] > 0).sum()))
        small = torch.nn.functional.interpolate(masks[best][None, None], size=(out_h, out_w), mode="bilinear", align_corners=False)
        mask = (small[0, 0] > 0).to(torch.uint8).numpy()
    return mask, float(scores[best])


def warm_up():
    """Loads the models used most (recognition, selecting, erasing) right after start."""
    for name, load in (("segment", _seg), ("sam", _sam), ("inpaint", _lama)):
        try:
            _get(name, load)
        except Exception as e:  # noqa: BLE001 - a missing model is loaded again on first use
            print(f"warm-up {name} failed: {e}", flush=True)
