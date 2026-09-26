---
title: furnuture AI
emoji: 🛋️
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# furnuture AI-server

De zware AI van furnuture op een **gratis** Hugging Face Space, zodat je iPad niets zwaars
meer hoeft te doen (en dus niet meer vastloopt). Gebruikt ook sterkere modellen dan in
de browser passen:

| Taak | Model |
| --- | --- |
| Kamer herkennen | SegFormer-B5 (ADE20K, 640 px) |
| Tik-om-te-selecteren | SAM ViT-B |
| Weggummen | LaMa |
| Uitknippen productfoto | RMBG-1.4 (niet-commercieel) |
| Foto's sorteren | CLIP ViT-B/16 |

## Opzetten (± 5 minuten, eenmalig)

1. Maak een gratis account op [huggingface.co](https://huggingface.co).
2. **New Space** → naam bijvoorbeeld `furnuture-ai` → SDK **Docker** (Blank) →
   hardware **CPU basic (free)** → Public → Create.
3. Upload in de Space (Files → Add file → Upload files) deze bestanden uit de map
   `ai-server`: `README.md`, `Dockerfile`, `requirements.txt`, `app.py`, `models.py`.
4. Wacht tot de Space "Running" is (de eerste keer bouwen en de modellen downloaden duurt
   ongeveer 5–10 minuten).
5. Open furnuture → **⋯ Project** → **☁️ AI-server** en plak de link van je Space
   (bijvoorbeeld `https://huggingface.co/spaces/jouwnaam/furnuture-ai`) → Opslaan & testen.

Voor al je apparaten tegelijk: zet in Vercel de omgevingsvariabele
`NEXT_PUBLIC_AI_SERVER=https://jouwnaam-furnuture-ai.hf.space` en deploy opnieuw.

## Goed om te weten

- Een gratis Space slaapt na 48 uur zonder gebruik. De app maakt hem vanzelf wakker;
  dat duurt dan ongeveer een minuut.
- Je foto's gaan naar je eigen Space en worden niet bewaard (alleen de analyse van de
  laatste paar foto's voor tik-om-te-selecteren, in het geheugen).
- Is de server even niet bereikbaar, dan valt de app terug op de AI in de browser.
