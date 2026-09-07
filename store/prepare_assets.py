"""Resize FoxFill store screenshots + icon for Chrome Web Store."""
from pathlib import Path
from PIL import Image

ASSETS = Path(
    r"C:\Users\msvn\.cursor\projects\d-repos-testing\assets"
)
OUT = Path(r"D:\repos\FoxFill\store")
OUT.mkdir(parents=True, exist_ok=True)

SHOTS = [
    (
        "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_ExampleOfScan2-70e56a7e-a334-4a5a-acaa-58a4be7e8409.png",
        "01-scan-certain.png",
    ),
    (
        "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_ThinkingExample-60644e32-06fc-40d8-897b-e586676d18be.png",
        "02-scan-review.png",
    ),
    (
        "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_FilledInExample-520c55e2-bf6a-4efe-8437-5e47e9f5776a.png",
        "03-fill-complete.png",
    ),
    (
        "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_FilledInExample2-fbd30b37-2b7b-49ac-b754-f852bac441ae.png",
        "04-fill-contact.png",
    ),
    (
        "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_Setting-cde718ef-4871-4b8d-bf69-eabcaab5a8e7.png",
        "05-settings.png",
    ),
]

ICON_SRC = (
    "c__Users_msvn_AppData_Roaming_Cursor_User_workspaceStorage_e4686449c327515853a7c96b639dc2ff_images_FoxFill-95ee2cef-7f1f-4087-bcc2-33fe84ee08f3.jpg"
)

TARGET_W, TARGET_H = 1280, 800
BG = (15, 61, 46)  # FoxFill forest green


def fit_cover(im: Image.Image, tw: int, th: int) -> Image.Image:
    """Scale to cover target, center-crop (no letterbox stretch)."""
    im = im.convert("RGB")
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return im.crop((left, top, left + tw, top + th))


def fit_contain(im: Image.Image, tw: int, th: int, bg=BG) -> Image.Image:
    """Scale to fit inside target, pad with brand green (good for tall UI shots)."""
    im = im.convert("RGB")
    sw, sh = im.size
    scale = min(tw / sw, th / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (tw, th), bg)
    canvas.paste(im, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def make_icon(src: Path, dest: Path, size: int = 128) -> None:
    im = Image.open(src).convert("RGBA")
    # Flatten onto forest green (no alpha for store icon safety)
    bg = Image.new("RGB", im.size, BG)
    bg.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
    # Cover square then resize
    w, h = bg.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    sq = bg.crop((left, top, left + side, top + side))
    out = sq.resize((size, size), Image.Resampling.LANCZOS)
    out.save(dest, format="PNG")  # RGB, no alpha
    print(f"icon -> {dest} {out.size} mode={out.mode}")


def main() -> None:
    for src_name, out_name in SHOTS:
        src = ASSETS / src_name
        im = Image.open(src)
        print(f"src {out_name}: {im.size[0]}x{im.size[1]} mode={im.mode}")
        # Browser captures are often wider than 1280/800 — cover crop looks natural.
        # Settings page is taller/narrower — contain + pad.
        if "settings" in out_name:
            framed = fit_contain(im, TARGET_W, TARGET_H)
        else:
            framed = fit_cover(im, TARGET_W, TARGET_H)
        dest = OUT / out_name
        framed.save(dest, format="PNG")
        check = Image.open(dest)
        print(f"  -> {dest.name} {check.size[0]}x{check.size[1]} mode={check.mode}")

    icon_src = ASSETS / ICON_SRC
    print(f"icon src: {Image.open(icon_src).size}")
    make_icon(icon_src, OUT / "store-icon-128.png", 128)

    # Also drop a JPEG set (sometimes preferred by the dashboard)
    for png in OUT.glob("0*.png"):
        jpg = OUT / (png.stem + ".jpg")
        Image.open(png).convert("RGB").save(jpg, format="JPEG", quality=92)
        print(f"jpg -> {jpg.name}")


if __name__ == "__main__":
    main()
