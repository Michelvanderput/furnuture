"""
furnuture AI server: the heavy AI of the app, on a free Hugging Face Space (CPU,
16 GB). The web app sends a photo and gets a mask or an image back, so nothing
heavy runs on the iPad.
"""

import base64
import io
import json
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

import models

app = FastAPI(title="furnuture AI")
# The app runs on another domain (Vercel) and calls this server from the browser.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MAX_SIDE = 2048
# One job at a time: two big models at once on 2 CPUs is slower for both.
_job = threading.Lock()


async def _image(upload: UploadFile) -> Image.Image:
    data = await upload.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Afbeelding te groot")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Geen afbeelding: {e}") from e
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE))
    return img


def _png(img: Image.Image) -> Response:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


async def _run(fn, *args):
    def locked():
        with _job:
            return fn(*args)

    try:
        return await run_in_threadpool(locked)
    except KeyError:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"AI mislukt: {e}") from e


@app.on_event("startup")
def _warm_up():
    threading.Thread(target=models.warm_up, daemon=True).start()


@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "version": 1, "models": models.loaded()}


@app.post("/segment")
async def segment(image: UploadFile = File(...), out_w: int = Form(...), out_h: int = Form(...)):
    if not (0 < out_w <= 2048 and 0 < out_h <= 2048):
        raise HTTPException(400, "Ongeldige maat")
    class_map, id2label, model = await _run(models.segment, await _image(image), out_w, out_h)
    return {"classMap": base64.b64encode(class_map.tobytes()).decode(), "id2label": id2label, "model": model, "w": out_w, "h": out_h}


@app.post("/classify")
async def classify(images: list[UploadFile] = File(...), labels: str = Form(...)):
    imgs = [await _image(i) for i in images[:60]]
    return {"labels": await _run(models.classify, imgs, json.loads(labels))}


@app.post("/remove-background")
async def remove_background(image: UploadFile = File(...)):
    return _png(await _run(models.remove_background, await _image(image)))


@app.post("/inpaint")
async def inpaint(image: UploadFile = File(...), mask: UploadFile = File(...)):
    img = await _image(image)
    return _png(await _run(models.inpaint, img, await _image(mask)))


@app.post("/sam/embed")
async def sam_embed(image: UploadFile = File(...)):
    img = await _image(image)
    return {"id": await _run(models.sam_embed, img), "w": img.size[0], "h": img.size[1]}


class MaskRequest(BaseModel):
    id: str
    points: list[list[float]]
    labels: list[int]
    out_w: int
    out_h: int
    box: list[float] | None = None


@app.post("/sam/mask")
async def sam_mask(req: MaskRequest):
    if not req.points or len(req.points) != len(req.labels):
        raise HTTPException(400, "Punten ontbreken")
    try:
        mask, score = await _run(models.sam_mask, req.id, req.points, req.labels, req.out_w, req.out_h, req.box)
    except KeyError as e:
        # Analysis no longer here (server restarted, or too many photos): the app analyses again.
        raise HTTPException(404, "Analyse verlopen") from e
    return {"mask": base64.b64encode(mask.tobytes()).decode(), "score": score}
