import json
import urllib.request
import os

def fetch_and_filter_data():
    url = "https://furoku.github.io/bananaX/projects/infographic-evaluation/en/evaluation_data.json"
    output_file = "extracted_prompts.json"
    
    print(f"Fetching data from {url}...")
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
        
        filtered_data = []
        for item in data:
            # Create a new dictionary without the 'comments' key. 
            # We keep 'id', 'number', 'name' (title), 'scores', 'total', 'img', 'yaml' (prompt)
            filtered_item = {k: v for k, v in item.items() if k != 'comments'}
            
            # Optionally, we can make the paths absolute or complete the URL for images
            if 'img' in filtered_item and filtered_item['img'].startswith('assets/'):
                filtered_item['img'] = "https://furoku.github.io/bananaX/projects/infographic-evaluation/" + filtered_item['img']
                
            filtered_data.append(filtered_item)
            
        print(f"Successfully processed {len(filtered_data)} items.")
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(filtered_data, f, ensure_ascii=False, indent=4)
            
        print(f"Data saved to {os.path.abspath(output_file)}")
        return True
        
    except Exception as e:
        print(f"Error occurred: {e}")
        return False

if __name__ == "__main__":
    fetch_and_filter_data()
