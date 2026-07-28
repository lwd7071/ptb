"""
detect_slots.py — Tự động đo tọa độ các ô ảnh (slot) trong 1 file khung PNG.

Cách dùng:
    python detectslot.py frames/multi-1.png --slots 6
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:
    print("Cần cài scipy: pip install scipy --break-system-packages", file=sys.stderr)
    sys.exit(1)


def is_target_color(arr):
    is_white = (arr[..., 0] > 245) & (arr[..., 1] > 245) & (arr[..., 2] > 245)
    is_black = (arr[..., 0] < 15) & (arr[..., 1] < 15) & (arr[..., 2] < 15)
    return is_white | is_black


def get_slot_from_center(arr, est_x, est_y):
    w_mask = is_target_color(arr)
    y0, y1 = est_y, est_y
    x0, x1 = est_x, est_x

    while x0 > 0 and np.mean(w_mask[max(0, est_y - 30):min(arr.shape[0], est_y + 30), x0]) > 0.8:
        x0 -= 1
    while x1 < arr.shape[1] - 1 and np.mean(w_mask[max(0, est_y - 30):min(arr.shape[0], est_y + 30), x1]) > 0.8:
        x1 += 1
    while y0 > 0 and np.mean(w_mask[y0, max(0, x0 + 20):min(arr.shape[1], x1 - 20)]) > 0.8:
        y0 -= 1
    while y1 < arr.shape[0] - 1 and np.mean(w_mask[y1, max(0, x0 + 20):min(arr.shape[1], x1 - 20)]) > 0.8:
        y1 += 1

    return {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}


def detect_slots(image_path, expected_slots=6, min_area_ratio=0.01):
    im = Image.open(image_path).convert("RGB")
    arr = np.array(im)
    w, h = im.size
    mask = is_target_color(arr)
    labeled, n = ndimage.label(mask)
    min_area = w * h * min_area_ratio

    boxes = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < min_area:
            continue
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        # Bỏ qua nếu vùng trắng dính viền mép ngoài của canvas (họa tiết viền ngoài)
        if x0 <= 10 or y0 <= 10 or x1 >= w - 10 or y1 >= h - 10:
            continue
        boxes.append([int(x0), int(y0), int(x1), int(y1)])

    if len(boxes) < expected_slots:
        # Tự động chuyển sang thuật toán quét tia từ tâm ô khi họa tiết ngoài dính vào ô
        if expected_slots == 6:
            centers = [
                (int(w * 0.20), int(h * 0.38)),
                (int(w * 0.50), int(h * 0.38)),
                (int(w * 0.80), int(h * 0.38)),
                (int(w * 0.20), int(h * 0.68)),
                (int(w * 0.50), int(h * 0.68)),
                (int(w * 0.80), int(h * 0.68))
            ]
            refined = [get_slot_from_center(arr, cx, cy) for cx, cy in centers]
            return {"canvasWidth": w, "canvasHeight": h, "slots": refined}
        elif expected_slots == 1:
            refined = [get_slot_from_center(arr, int(w * 0.5), int(h * 0.5))]
            return {"canvasWidth": w, "canvasHeight": h, "slots": refined}

    boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    boxes = boxes[:expected_slots]
    boxes.sort(key=lambda b: (round(b[1] / 50), b[0]))

    refined = []
    for (x0, y0, x1, y1) in boxes:
        refined.append({
            "x": x0, "y": y0, "w": x1 - x0, "h": y1 - new_y0 if 'new_y0' in locals() else y1 - y0,
        })

    return {"canvasWidth": w, "canvasHeight": h, "slots": refined}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Đo tọa độ ô ảnh trong file khung PNG")
    parser.add_argument("image", help="Đường dẫn tới file khung, vd frames/multi-3.png")
    parser.add_argument("--slots", type=int, default=6, help="Số ô ảnh cần tìm (mặc định 6, dùng 1 cho khung single)")
    parser.add_argument("--min-area", type=float, default=0.01, help="Ngưỡng diện tích tối thiểu (tỉ lệ so với ảnh gốc)")
    args = parser.parse_args()

    result = detect_slots(args.image, expected_slots=args.slots, min_area_ratio=args.min_area)
    print(json.dumps(result, ensure_ascii=False, indent=2))
