import mimetypes
import os
import requests
import json
import sys
from google import genai
from google.genai import types

def save_binary_file(file_name, data):
    with open(file_name, "wb") as f:
        f.write(data)
    print(f"File saved to: {file_name}")

def try_translate(api_key, img_data, item_id, key_label):
    print(f"\n--- Attempting with {key_label} ---")
    client = genai.Client(api_key=api_key)
    
    model = "gemini-2.5-flash-image"
    
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=img_data, mime_type="image/png"),
                types.Part.from_text(
                    text="Recreate this infographic image identically, but translate ALL Japanese text to English. "
                         "Keep the exact same layout, colors, illustration style, fonts, and design elements. "
                         "Only the language of the text should change from Japanese to English."
                ),
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        response_modalities=["IMAGE"],
    )

    try:
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.parts is None:
                continue
            if chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
                file_name = f"{item_id}_translated"
                inline_data = chunk.parts[0].inline_data
                data_buffer = inline_data.data
                file_extension = mimetypes.guess_extension(inline_data.mime_type)
                if not file_extension:
                    file_extension = ".png"
                save_binary_file(f"{file_name}{file_extension}", data_buffer)
                return True
            else:
                if chunk.text:
                    print(f"Model text response: {chunk.text}")
        print("No image was returned by the model.")
        return False
    except Exception as e:
        print(f"Error with {key_label}: {e}")
        return False

def main():
    API_KEY_1 = "AIzaSyCHanUg7VgWr2dmYiz_UVSnJsxdG7SZvwU"
    API_KEY_2 = "AIzaSyAOxhOlkFU5aiPYcnsqxExErOIw7u2YhQ8"

    with open('extracted_prompts.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Use the Memphis style card (#73) as our test image
    target_item = None
    for item in data:
        if "Flat illustration / Corporate / Memphis" in item.get('name', ''):
            target_item = item
            break
    if not target_item:
        target_item = data[0]

    img_url = target_item['img']
    item_id = target_item['id']
    print(f"Target: #{target_item['number']} - {target_item['name']}")
    print(f"Downloading image from {img_url}...")
    
    img_resp = requests.get(img_url)
    img_data = img_resp.content
    save_binary_file(f"{item_id}_original.png", img_data)

    # Try Key 1
    success = try_translate(API_KEY_1, img_data, item_id, "API Key #1")
    
    if not success:
        # Try Key 2
        success = try_translate(API_KEY_2, img_data, item_id, "API Key #2 (fallback)")
    
    if success:
        print(f"\n✅ SUCCESS! Translated image saved.")
    else:
        print(f"\n❌ FAILED with both API keys.")
        sys.exit(1)

if __name__ == "__main__":
    main()
