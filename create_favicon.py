from PIL import Image
import os

logo_path = r"D:\mahumbezi-backend\mahumbezi-backend\public\assets\logo.png"
output_path = r"D:\mahumbezi-backend\mahumbezi-backend\public\assets\favicon.png"

# Open the logo image
img = Image.open(logo_path)
print(f"Original size: {img.size}, mode: {img.mode}")

# Resize to 32x32 for favicon (good size for browser tabs)
img_32 = img.resize((32, 32), Image.LANCZOS)
img_32.save(output_path, format="PNG")
print(f"Saved favicon to {output_path}")

# Also create a 16x16 version
img_16 = img.resize((16, 16), Image.LANCZOS)
img_16.save(output_path.replace(".png", "-16.png"), format="PNG")
print("Also created 16x16 version")

# Verify
img_check = Image.open(output_path)
print(f"Favicon size: {img_check.size}")