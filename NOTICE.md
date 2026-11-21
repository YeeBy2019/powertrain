# Sources and notices

Everything this repository did not write itself, and the terms it comes under.

## The models

`public/assets/*.glb` — 60 GLBs, ~206 MB in total.

| Stage | What it is | Terms |
| --- | --- | --- |
| Authoring | **NVIDIA SimReady** asset library — forklifts, racks, conveyors, engine assemblies, robots, test equipment and factory set dressing. | **CC BY 4.0**. Attribution required; commercial use and derivatives are permitted. |
| Conversion | Converted to GLB in [`codepawl/simready-glb`](https://huggingface.co/datasets/codepawl/simready-glb), a Hugging Face dataset published by CodePawl. | CC BY 4.0, inherited from the source assets. |
| Download | [`tools/fetch_assets.py`](tools/fetch_assets.py) fetches the GLBs and their thumbnails from that dataset. Existing files are skipped. | The script is MIT (this project). |
| In-app use | `flattenModel` merges geometry by material; repeated items are drawn as `InstancedMesh`. The forklift is split into moving parts. | Derivative use of CC BY 4.0 models — allowed, with attribution. |

**Attribution:** "NVIDIA SimReady assets (CC BY 4.0), converted by CodePawl in `codepawl/simready-glb`."

The models are not hand-authored in this repository. Re-running the fetch script recreates them;
they are committed so that a clean clone runs without a download. A few base assets are shared with
Rackline; the powertrain-specific increment (engine assemblies, robots, test benches, drivetrain
parts, engine components) is listed in `fetch_assets.py`.

## Environment and textures

| File | Source | Terms |
| --- | --- | --- |
| `public/env/empty_warehouse_01_2k.hdr` | [Poly Haven](https://polyhaven.com/a/empty_warehouse_01), `empty_warehouse_01`, 2K HDRI | **CC0** — no attribution required |
| `public/textures/floor_diff.jpg`, `floor_nor_gl.jpg`, `floor_rough.jpg` | [Poly Haven](https://polyhaven.com/a/concrete_floor_worn_001), `concrete_floor_worn_001` | **CC0** — no attribution required |

## The code this started from

[`codepawl/3d-builds`](https://github.com/codepawl/3d-builds), work
[`works/2026-10-31-rackline`](https://github.com/codepawl/3d-builds/tree/main/works/2026-10-31-rackline)
("Rackline", 2026-10-31) — **MIT**, Copyright (c) 2026 CodePawl.

Rackline is the live automated pallet warehouse from [@anxuanng](https://x.com/anxuanng)'s post
<https://x.com/anxuanng/status/2116504653215248436>. This project keeps its renderer setup, the
fixed-step simulation driver, the camera/picking model and the film-recorder approach, and reworks
the building, product semantics, instance pools, materials, camera, HUD and documentation into an
engine-assembly plant. What remains from upstream is the architecture and the MIT licence.

The README's structure and bilingual layout are modelled on
[`head-tracked-3d`](https://github.com/YeeBy2019/head-tracked-3d), also MIT.

## Libraries

| Library | Version | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) | 0.186.1 | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) | 6.39.5 | MIT |
| [n8ao](https://github.com/N8AO/N8AO) | 1.10.1 | MIT |
| [Vite](https://vitejs.dev) | 8.3.4 | MIT |
| [Playwright](https://playwright.dev) (recording only) | — | Apache-2.0 |
| [ffmpeg](https://ffmpeg.org) (GIF encoding only) | — | LGPL/GPL per build |

## What is not in this repository

- The NVIDIA SimReady **source** files (`.fbx`/`.blend`) and their original textures — only the
  converted GLBs are shipped.
- The Rackline film, frames and ElevenLabs sound files — this project ships its own silent demo.

## The preview

`media/preview.gif` is a real screen recording of this app: [`tools/film.mjs`](tools/film.mjs)
drives the scene through its own mouse controls on a virtual clock and writes one PNG per frame;
ffmpeg then encodes those frames into the GIF. No frame is composed by hand.
