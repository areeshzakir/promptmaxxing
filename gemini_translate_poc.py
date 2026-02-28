"""
Gemini Web UI Image Translation POC
====================================
Automates gemini.google.com to translate a Japanese infographic image to English.
Uses a persistent browser profile so the user only needs to log in once.
"""
import asyncio
import json
import os
import sys
import time
import requests
from playwright.async_api import async_playwright

# --- Configuration ---
PROFILE_DIR = os.path.join(os.path.dirname(__file__), ".gemini_browser_profile")
TRANSLATED_DIR = os.path.join(os.path.dirname(__file__), "translated_images")
ORIGINALS_DIR = os.path.join(os.path.dirname(__file__), "original_images")

TRANSLATION_PROMPT = (
    "Recreate this infographic image identically, but translate ALL Japanese text "
    "to English. Keep the exact same layout, colors, illustration style, fonts, "
    "and design elements. Only the language of the text should change from Japanese "
    "to English."
)

async def ensure_login(page):
    """Navigate to Gemini and ensure the user is logged in."""
    print("Navigating to gemini.google.com...")
    await page.goto("https://gemini.google.com", wait_until="domcontentloaded", timeout=60000)
    await asyncio.sleep(5)

    # Check if we're on a login page or the main app
    url = page.url
    if "accounts.google.com" in url or "signin" in url.lower():
        print("\n" + "=" * 60)
        print("  🔐 LOGIN REQUIRED")
        print("  Please log in to your Google account in the browser window.")
        print("  The script will continue automatically after you log in.")
        print("=" * 60 + "\n")
        # Wait for the user to complete login (up to 5 minutes)
        try:
            await page.wait_for_url("**gemini.google.com**", timeout=300000)
            await asyncio.sleep(3)
            print("✅ Login detected! Continuing...")
        except Exception:
            print("❌ Login timed out. Please try again.")
            return False

    # Verify we're on the Gemini page
    try:
        await page.wait_for_selector(
            'div[aria-label="Enter a prompt for Gemini"]',
            timeout=30000
        )
        print("✅ Gemini interface loaded successfully!")
        return True
    except Exception:
        print("❌ Could not find the Gemini prompt input. Page might not have loaded correctly.")
        await page.screenshot(path="debug_gemini_page.png")
        print("Debug screenshot saved to debug_gemini_page.png")
        return False


async def translate_single_image(page, image_path, output_path):
    """Upload an image and send translation prompt, then download the result."""

    # Step 1: Click the upload button and upload the file
    print("  📎 Uploading image...")
    
    # First, click the upload/attachment button to open the menu
    upload_btn = page.locator('button[aria-label="Open upload file menu"]')
    await upload_btn.click()
    await asyncio.sleep(1)
    
    # Now look for the "Upload file" menu option and click it with file chooser expected
    try:
        async with page.expect_file_chooser(timeout=15000) as fc_info:
            # Try various selectors for the "Upload file" menu item
            upload_file_option = page.get_by_text("Upload file").first
            if await upload_file_option.count() > 0:
                await upload_file_option.click()
            else:
                # Try alternative selectors
                alt_option = page.locator('[data-value="upload_file"], [aria-label*="Upload file"], .upload-menu-item').first
                await alt_option.click()
        
        file_chooser = await fc_info.value
        await file_chooser.set_files(image_path)
        print("  ✅ Image uploaded!")
    except Exception as e:
        print(f"  ⚠️ File chooser approach failed: {e}")
        print("  Trying alternative: direct input[type=file] injection...")
        # Fallback: inject a file input and use it directly
        await page.evaluate("""() => {
            const existing = document.querySelector('#injected-file-input');
            if (existing) existing.remove();
        }""")
        await page.evaluate("""() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.id = 'injected-file-input';
            input.style.display = 'none';
            input.accept = 'image/*';
            document.body.appendChild(input);
        }""")
        file_input = page.locator('#injected-file-input')
        await file_input.set_input_files(image_path)
        # Now try dragging via the upload button again
        # Actually, let's try the native file input if one exists
        native_inputs = page.locator('input[type="file"]')
        count = await native_inputs.count()
        if count > 0:
            print(f"  Found {count} file input(s), using the last one...")
            await native_inputs.last.set_input_files(image_path)
            print("  ✅ Image uploaded via native input!")
        else:
            print("  ❌ Could not find any file input mechanism.")
            await page.screenshot(path="debug_upload_fail.png")
            return False

    # Wait for the image to be attached/processed
    await asyncio.sleep(3)

    # Step 2: Type the translation prompt
    print("  ✍️  Typing prompt...")
    prompt_input = page.locator('div[aria-label="Enter a prompt for Gemini"]')
    await prompt_input.click()
    await prompt_input.fill(TRANSLATION_PROMPT)
    await asyncio.sleep(1)

    # Step 3: Click send
    print("  📤 Sending...")
    send_btn = page.locator('button[aria-label="Send message"]')
    await send_btn.click()

    # Step 4: Wait for the response to complete
    print("  ⏳ Waiting for Gemini to generate the translated image...")
    # Wait for the loading/thinking indicator to appear and then disappear
    # The response can take 15-60 seconds for image generation
    
    # First, wait for the response to start
    await asyncio.sleep(5)
    
    # Wait for any loading indicator to disappear (up to 120 seconds)
    max_wait = 120
    start = time.time()
    while time.time() - start < max_wait:
        # Check if there's a loading/generating indicator
        is_loading = await page.locator('.loading-indicator, .thinking-indicator, [aria-label*="loading"], [aria-label*="Generating"]').count()
        
        # Also check if stop button is visible (means still generating)
        stop_btn = await page.locator('button[aria-label="Stop response"], button[aria-label="Stop generating"]').count()
        
        if is_loading == 0 and stop_btn == 0:
            # Double check by waiting a moment and checking again
            await asyncio.sleep(2)
            stop_btn2 = await page.locator('button[aria-label="Stop response"], button[aria-label="Stop generating"]').count()
            if stop_btn2 == 0:
                break
        
        elapsed = int(time.time() - start)
        print(f"  ⏳ Still generating... ({elapsed}s)")
        await asyncio.sleep(5)
    
    print("  ✅ Response received!")
    await asyncio.sleep(2)

    # Step 5: Find and download the generated image
    print("  💾 Looking for generated image...")
    
    # Look for images in the response area
    # Gemini typically renders generated images as <img> tags in the response
    response_images = page.locator('.response-container img, .model-response-text img, .message-text img, .response-content img, [data-message-author-role="model"] img')
    img_count = await response_images.count()
    
    if img_count == 0:
        # Try a broader search for any new images that appeared
        all_images = page.locator('img[src*="blob:"], img[src*="data:"], img[src*="generated"], img[src*="lh3.googleusercontent"]')
        img_count = await all_images.count()
        response_images = all_images
    
    if img_count > 0:
        # Get the last image (most likely the generated one)
        last_img = response_images.last
        src = await last_img.get_attribute("src")
        print(f"  Found image (src type: {src[:30] if src else 'None'}...)")
        
        if src and (src.startswith("http") or src.startswith("blob:") or src.startswith("data:")):
            # For blob/data URLs, we need to extract via JavaScript
            img_data = await page.evaluate("""
                async (imgElement) => {
                    const response = await fetch(imgElement.src);
                    const blob = await response.blob();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                }
            """, await last_img.element_handle())
            
            if img_data and "base64," in img_data:
                import base64
                base64_data = img_data.split("base64,")[1]
                with open(output_path, "wb") as f:
                    f.write(base64.b64decode(base64_data))
                print(f"  ✅ Translated image saved to: {output_path}")
                return True
    
    # Fallback: take a screenshot of the response area
    print("  ⚠️  Could not extract image directly. Taking a screenshot of the response...")
    await page.screenshot(path="debug_response.png", full_page=True)
    print("  Debug screenshot saved to debug_response.png")
    
    # Try right-click download approach
    print("  Attempting alternative download method...")
    # Look for download buttons that Gemini provides on generated images
    download_btns = page.locator('button[aria-label*="Download"], button[aria-label*="download"], [data-tooltip*="Download"]')
    dl_count = await download_btns.count()
    if dl_count > 0:
        async with page.expect_download(timeout=30000) as dl_info:
            await download_btns.last.click()
        download = await dl_info.value
        await download.save_as(output_path)
        print(f"  ✅ Downloaded via button: {output_path}")
        return True
    
    print("  ❌ Could not download the generated image automatically.")
    return False


async def main():
    # Ensure output directories exist
    os.makedirs(TRANSLATED_DIR, exist_ok=True)
    os.makedirs(ORIGINALS_DIR, exist_ok=True)
    
    # Load the extracted data
    with open("extracted_prompts.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Find our test image (#73 - Memphis style)
    target = None
    for item in data:
        if "Memphis" in item.get("name", ""):
            target = item
            break
    if not target:
        target = data[0]
    
    item_id = target["id"]
    img_url = target["img"]
    print(f"🎯 Target: #{target['number']} - {target['name']}")
    
    # Download original image
    orig_path = os.path.join(ORIGINALS_DIR, f"{item_id}.png")
    if not os.path.exists(orig_path):
        print(f"📥 Downloading original from {img_url}...")
        resp = requests.get(img_url)
        with open(orig_path, "wb") as f:
            f.write(resp.content)
    
    output_path = os.path.join(TRANSLATED_DIR, f"{item_id}_en.png")
    
    # Launch browser with persistent profile
    print("\n🌐 Launching browser...")
    print("   (Using persistent profile so you only need to log in once)\n")
    
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,  # Must be visible for login
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        
        page = context.pages[0] if context.pages else await context.new_page()
        
        # Ensure user is logged in
        logged_in = await ensure_login(page)
        if not logged_in:
            await context.close()
            sys.exit(1)
        
        # Translate the image
        print(f"\n🔄 Translating image: {item_id}")
        success = await translate_single_image(page, orig_path, output_path)
        
        if success:
            print(f"\n🎉 POC SUCCESS! Check:")
            print(f"   Original:   {orig_path}")
            print(f"   Translated: {output_path}")
        else:
            print(f"\n⚠️  POC completed with issues. Check debug screenshots.")
        
        # Keep browser open for a moment so user can inspect
        print("\n⏸️  Browser will close in 10 seconds (inspect the result if needed)...")
        await asyncio.sleep(10)
        await context.close()

if __name__ == "__main__":
    asyncio.run(main())
