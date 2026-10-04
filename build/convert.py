"""Convert the Design-canvas mockups (.dc.html) into the static pages of peternilsson.us/consulting.

Usage: python3 build/convert.py <folder holding the .dc.html files>
Re-run after the mockups change; it rewrites consulting/**/index.html.
"""
import os, re, sys

SRC = sys.argv[1]
ROOT = os.path.join(os.path.dirname(__file__), '..')

PAGES = {
    'Main.dc.html':       ('',          'Peter Nilsson — Clear thinking about AI and schools',
                           'Peter Nilsson helps schools think clearly about AI through consulting, keynotes, and writing, including the book Irreplaceable.'),
    'Consulting.dc.html': ('schools/',  'Consulting for schools — Peter Nilsson',
                           'AI consulting for independent schools: leadership, faculty, departments, boards, parents, and students, designed in partnership with campus leaders.'),
    'Speaking.dc.html':   ('speaking/', 'Speaking — Peter Nilsson',
                           'Keynotes and workshops for educators navigating AI, including How AI Changes Everything and Nothing in Teaching and Learning.'),
    'Writing.dc.html':    ('writing/',  'Writing — Peter Nilsson',
                           'Irreplaceable (Solution Tree, 2026), the Educator\'s Notebook newsletter, and other projects by Peter Nilsson.'),
    'About.dc.html':      ('about/',    'About — Peter Nilsson',
                           'Peter Nilsson is an educator, author, and musician: former Deerfield Academy teacher, Head of School at King\'s Academy, and co-author of Irreplaceable.'),
}

FONTS = ('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;'
         '1,6..72,300;1,6..72,400;1,6..72,600&amp;family=Hanken+Grotesk:wght@400;500;600&amp;family=Figtree:wght@300;400;700&amp;display=swap')

def build(name, slug, title, desc):
    src = open(os.path.join(SRC, name), encoding='utf-8').read()
    body = src[src.index('</helmet>') + len('</helmet>'):src.index('</x-dc>')].strip()
    up = '../' if slug else './'          # path from this page back to /consulting/

    # Links between the mockup pages -> real relative URLs
    for other, (oslug, _, _) in PAGES.items():
        body = body.replace(f'href="{other}"', f'href="{up}{oslug}"')
    body = body.replace('href="#" aria-current="page"', 'href="./" aria-current="page"')
    body = body.replace('<a href="#" style="font-family: \'Figtree\'', f'<a href="{up}" style="font-family: \'Figtree\'', 1)
    # Artifact asset ids -> site images
    for bid, fn in {'4dbe492ff282d3f931770a06d61c346b': 'endorse-bali.jpg', '0cf12e4d7d83ae0581832a146d6b7c75': 'endorse-gardner.jpg', '1e7cffb1d82e4f5ff44e54bd28b0b454': 'endorse-fadel.jpg'}.items():
        body = body.replace(f'src="/_blob/{bid}"', f'src="{up}img/{fn}" width="288" height="288"')
    body = re.sub(r'src="/_blob/[0-9a-f]+"', f'src="{up}img/irreplaceable-cover.jpg" width="720" height="1085"', body)
    body = body.replace('<img ', '<img loading="lazy" ') if slug else body
    # External links open in a new tab
    body = re.sub(r'<a href="(https?://[^"]+)"(?![^>]*target=)', r'<a href="\1" target="_blank" rel="noopener"', body)
    assert '.dc.html' not in body and '/_blob/' not in body and '{{' not in body, name
    leftover = re.findall(r'href="#"', body)
    if leftover:
        print(f'  note: {name} still has {len(leftover)} placeholder link(s)')

    canonical = 'https://peternilsson.us/consulting/' + slug
    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="https://peternilsson.us/consulting/img/irreplaceable-cover.jpg">
<link rel="icon" href="{up}../favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>
body{{margin:0;background:#FBFAF7}}
a{{color:#DF1E28;text-decoration:none}}
a:hover{{color:#00324A}}
a:focus-visible{{outline:2px solid #2E89B0;outline-offset:3px}}
img{{max-width:100%}}
</style>
</head>
<body>
{body}
</body>
</html>
'''
    out = os.path.join(ROOT, 'consulting', slug, 'index.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(html)
    print('wrote', os.path.relpath(out, ROOT))

for n, (s, t, d) in PAGES.items():
    build(n, s, t, d)
