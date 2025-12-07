import os
import sys
from pathlib import Path

def optimize_images(directory, threshold_mb=1.0):
    """
    Traverses the directory and optimizes PNG/JPG images larger than threshold_mb.
    Requires 'Pillow' library: pip install Pillow
    """
    try:
        from PIL import Image
    except ImportError:
        print("Error: Pillow library not found.")
        print("Please install it using: pip install Pillow")
        return

    print(f"Scanning {directory} for images larger than {threshold_mb} MB...")
    
    threshold_bytes = threshold_mb * 1024 * 1024
    optimized_count = 0
    saved_space = 0

    for root, _, files in os.walk(directory):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                file_path = os.path.join(root, file)
                size = os.path.getsize(file_path)

                if size > threshold_bytes:
                    print(f"Optimizing: {file_path} ({size / 1024 / 1024:.2f} MB)")
                    
                    try:
                        with Image.open(file_path) as img:
                            # Calculate new size (e.g., max 2048px dimension)
                            max_dim = 2048
                            if img.width > max_dim or img.height > max_dim:
                                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                            
                            # Save with optimization
                            original_size = size
                            if file.lower().endswith('.png'):
                                # Optimize PNG
                                img.save(file_path, "PNG", optimize=True)
                            else:
                                # Optimize JPG
                                img.save(file_path, "JPEG", quality=85, optimize=True)
                            
                            new_size = os.path.getsize(file_path)
                            saved = original_size - new_size
                            saved_space += saved
                            optimized_count += 1
                            print(f"  -> Done. New size: {new_size / 1024 / 1024:.2f} MB. Saved: {saved / 1024 / 1024:.2f} MB")
                            
                    except Exception as e:
                        print(f"  -> Failed to optimize {file}: {e}")

    print("-" * 40)
    print(f"Optimization Complete.")
    print(f"Files processed: {optimized_count}")
    print(f"Total space saved: {saved_space / 1024 / 1024:.2f} MB")

if __name__ == "__main__":
    target_dir = "assets"
    if len(sys.argv) > 1:
        target_dir = sys.argv[1]
    
    if not os.path.exists(target_dir):
        print(f"Directory not found: {target_dir}")
    else:
        optimize_images(target_dir)
