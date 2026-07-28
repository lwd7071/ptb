import argparse
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

def punch_frame(frame_key, config_data, threshold=245):
    frames_dir = "frames"
    originals_dir = os.path.join(frames_dir, "_originals")
    
    # Ensure _originals dir exists
    os.makedirs(originals_dir, exist_ok=True)
    
    original_path = os.path.join(originals_dir, f"{frame_key}.png")
    current_path = os.path.join(frames_dir, f"{frame_key}.png")
    
    # 1. Backup if not already backed up
    if not os.path.exists(original_path):
        if not os.path.exists(current_path):
            print(f"Lỗi: Không tìm thấy file {current_path}", file=sys.stderr)
            return False
        print(f"Đang backup bản gốc vào {original_path}...")
        shutil.copy2(current_path, original_path)
    
    # Check if frame exists in config
    frame_def = None
    if frame_key in config_data.get('multi', {}):
        frame_def = config_data['multi'][frame_key]
    elif frame_key in config_data.get('single', {}):
        frame_def = config_data['single'][frame_key]
        
    if not frame_def:
        print(f"Lỗi: Không tìm thấy config cho '{frame_key}' trong frames-config.json", file=sys.stderr)
        return False
        
    slots = frame_def.get('slots', [])
    if not slots:
        print(f"Lỗi: Khung '{frame_key}' không có định nghĩa slots", file=sys.stderr)
        return False
        
    print(f"\n--- Xử lý khung: {frame_key} ---")
    
    # 2. Read from backup
    try:
        im = Image.open(original_path).convert("RGBA")
    except Exception as e:
        print(f"Lỗi khi đọc file {original_path}: {e}", file=sys.stderr)
        return False
        
    arr = np.array(im)
    height, width = arr.shape[:2]
    
    # Tạo mask boolean tổng hợp (những pixel nào bị làm trong suốt)
    combined_mask = np.zeros((height, width), dtype=bool)
    
    has_warning = False
    
    pad = 5 # Mở rộng vùng tìm kiếm thêm 5px quanh ô để phủ kín mép viền
    
    # 3. Xử lý từng slot
    for i, slot in enumerate(slots):
        sx, sy, sw, sh = slot['x'], slot['y'], slot['w'], slot['h']
        
        # Tìm tâm ô
        cx, cy = sx + sw // 2, sy + sh // 2
        
        if cx < 0 or cx >= width or cy < 0 or cy >= height:
            print(f"  Slot {i+1}: Tâm ({cx}, {cy}) nằm ngoài ảnh!", file=sys.stderr)
            has_error = True
            continue
            
        # Đọc màu tại tâm ô để tự động quyết định là ô màu Đen hay Trắng
        center_color = arr[cy, cx][:3]
        
        # Hàm tạo mask tùy theo màu tâm ô
        if center_color[0] < 50 and center_color[1] < 50 and center_color[2] < 50:
            # Ô Đen
            is_target_mask = (arr[..., 0] < 20) & (arr[..., 1] < 20) & (arr[..., 2] < 20)
        elif center_color[0] > 200 and center_color[1] > 200 and center_color[2] > 200:
            # Ô Trắng
            is_target_mask = (arr[..., 0] >= threshold) & (arr[..., 1] >= threshold) & (arr[..., 2] >= threshold)
        else:
            print(f"  Slot {i+1}: CẢNH BÁO - Tâm ({cx}, {cy}) có màu {center_color} không phải Đen cũng không phải Trắng đục. Bỏ qua.", file=sys.stderr)
            continue
            
        # Xác định vùng giới hạn (padded box) cho slot này
        min_y, max_y = max(0, sy - pad), min(height, sy + sh + pad)
        min_x, max_x = max(0, sx - pad), min(width, sx + sw + pad)
        
        # Lấy vùng ảnh con
        sub_mask = is_target_mask[min_y:max_y, min_x:max_x]
        
        # Tìm các vùng liên thông trong vùng ảnh con
        labeled_sub, num_features = ndimage.label(sub_mask)
        
        # Tâm ô trong hệ tọa độ của ảnh con
        sub_cx = cx - min_x
        sub_cy = cy - min_y
        
        region_id = labeled_sub[sub_cy, sub_cx]
        
        if region_id == 0:
            print(f"  Slot {i+1}: CẢNH BÁO - Tâm ô không khớp với mask màu. Bỏ qua.", file=sys.stderr)
            continue
            
        region_mask = (labeled_sub == region_id)
        
        # Kiểm tra rò rỉ: Vùng liên thông có chạm mép của padded box không?
        # Nếu chạm mép, tức là nó đã rò rỉ xuyên qua lớp viền (border) và lan ra ngoài
        y_indices, x_indices = np.where(region_mask)
        rmin_y, rmax_y = y_indices.min(), y_indices.max()
        rmin_x, rmax_x = x_indices.min(), x_indices.max()
        
        touches_top = (rmin_y == 0 and min_y > 0)
        touches_bottom = (rmax_y == (max_y - min_y - 1) and max_y < height)
        touches_left = (rmin_x == 0 and min_x > 0)
        touches_right = (rmax_x == (max_x - min_x - 1) and max_x < width)
        
        if touches_top or touches_bottom or touches_left or touches_right:
            print(f"  Slot {i+1}: ⚠️ CẢNH BÁO RÒ RỈ! Vùng trắng chạm đến ranh giới giới hạn ({pad}px). Có thể nét đứt bị hở.", file=sys.stderr)
            has_warning = True
        else:
            print(f"  Slot {i+1}: ✅ OK")
            
        # Dù có rò rỉ hay không, ta vẫn áp mask vào vùng giới hạn (vì đã bị chặn lại ở mép padded box)
        # Giúp bảo vệ phần viền nằm ngoài padded box an toàn tuyệt đối, giống hệt cách JS hoạt động
        combined_mask[min_y:max_y, min_x:max_x] |= region_mask

    if has_warning:
        print(f"\n⚠️ Đã tạo file đục lỗ cho '{frame_key}' nhưng CÓ CẢNH BÁO RÒ RỈ.", file=sys.stderr)
        print("Vui lòng mở file bằng mắt để kiểm tra xem rò rỉ có làm mất viền khung không.", file=sys.stderr)
        
    # 5. Khử răng cưa (Gaussian blur) trên biên mask
    print("  Đang khử răng cưa mép đục lỗ (Gaussian Blur)...")
    # Đổi mask boolean sang float để blur
    mask_float = combined_mask.astype(float)
    # Blur nhẹ mask
    blurred_mask = ndimage.gaussian_filter(mask_float, sigma=1.5)
    
    # 6. Cập nhật kênh Alpha của ảnh gốc
    # mask = 1 -> alpha = 0 (trong suốt), mask = 0 -> alpha = 255 (đục)
    # Với blurred_mask, giá trị từ 0.0 -> 1.0. 
    # alpha_factor = 1.0 - blurred_mask
    alpha_channel = arr[..., 3].astype(float)
    new_alpha = alpha_channel * (1.0 - blurred_mask)
    
    arr[..., 3] = np.clip(new_alpha, 0, 255).astype(np.uint8)
    
    # Lưu lại đè lên file frames/<key>.png
    try:
        out_img = Image.fromarray(arr, "RGBA")
        out_img.save(current_path)
        print(f"✅ Xong! Đã lưu file đục lỗ tại: {current_path}")
        return True
    except Exception as e:
        print(f"Lỗi khi lưu file {current_path}: {e}", file=sys.stderr)
        return False

def main():
    parser = argparse.ArgumentParser(description="Đục lỗ (xóa vùng nền trắng) cho khung ảnh offline.")
    parser.add_argument("frame_key", nargs="?", help="Key của khung cần đục (vd: multi-1). Bỏ trống để đục TẤT CẢ khung.")
    parser.add_argument("--threshold", type=int, default=245, help="Ngưỡng màu trắng (RGB >= threshold, mặc định 245)")
    args = parser.parse_args()

    config_path = os.path.join("frames", "frames-config.json")
    if not os.path.exists(config_path):
        print(f"Lỗi: Không tìm thấy {config_path}", file=sys.stderr)
        sys.exit(1)
        
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)
    except Exception as e:
        print(f"Lỗi khi đọc file json: {e}", file=sys.stderr)
        sys.exit(1)
        
    if args.frame_key:
        punch_frame(args.frame_key, config_data, args.threshold)
    else:
        print(f"Đục lỗ tất cả các khung trong {config_path}...")
        success_count = 0
        keys = []
        if 'multi' in config_data:
            keys.extend(list(config_data['multi'].keys()))
        if 'single' in config_data:
            keys.extend(list(config_data['single'].keys()))
            
        for key in keys:
            if punch_frame(key, config_data, args.threshold):
                success_count += 1
        print(f"\nĐã hoàn thành: {success_count}/{len(keys)} khung.")

if __name__ == "__main__":
    main()
