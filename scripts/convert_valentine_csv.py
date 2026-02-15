"""Convert valentine_data_2026.csv to valentine_data.json"""
import csv
import json
import os

def main():
    csv_path = os.path.join(os.path.dirname(__file__), '..', 'valentine_data_2026.csv')
    out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'valentine_data.json')

    result = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        years = [str(y) for y in range(2018, 2027)]
        for row in reader:
            name = row['이름'].strip()
            if not name:
                continue
            letters = {}
            for year in years:
                val = row.get(year, '').strip()
                if val and val != '없음':
                    letters[year] = val
            if letters:
                result.append({'name': name, 'letters': letters})

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=None)

    print(f'Converted {len(result)} shipgirls to {out_path}')

if __name__ == '__main__':
    main()
