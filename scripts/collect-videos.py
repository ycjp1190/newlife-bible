"""공동체성경읽기 채널(@PRS)의 '장별 구절 영상(개역개정)' 재생목록 66개 → 장별 영상 ID 수집.
결과: data/chapter-videos.json  {"playlists": {책: id}, "videos": {"책 장": videoId}}
실행: python3 scripts/collect-videos.py data/chapter-videos.json  →  node scripts/build-videos.mjs
(재생목록 안의 순서는 장 순서가 아니어서 제목의 'n장'으로 맞춘다)
"""
import json, re, sys, time, urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept-Language": "ko-KR,ko;q=0.9"}
OUT = sys.argv[1]


def get(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
                                 headers={**UA, **({"Content-Type": "application/json"} if data else {})})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8")


def initial(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    return json.loads(m.group(1))


def cfg(html):
    key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html).group(1)
    ver = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html).group(1)
    return key, ver


def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values():
            walk(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk(v, fn)


def lockups(d):
    """lockupViewModel → (contentId, title), continuation tokens"""
    items, conts = [], []

    def fn(o):
        if "lockupViewModel" in o:
            lv = o["lockupViewModel"]
            t = lv.get("metadata", {}).get("lockupMetadataViewModel", {}).get("title", {}).get("content")
            items.append((lv.get("contentId"), lv.get("contentType"), t))
        if "playlistVideoRenderer" in o:
            r = o["playlistVideoRenderer"]
            items.append((r["videoId"], "VIDEO", "".join(x["text"] for x in r["title"]["runs"])))
        if "continuationCommand" in o and "token" in o["continuationCommand"]:
            conts.append(o["continuationCommand"]["token"])
    walk(d, fn)
    return items, conts


def browse_all(url):
    for attempt in range(5):
        html = get(url)
        if "var ytInitialData = " in html:
            break
        time.sleep(3 + attempt * 3)
    key, ver = cfg(html)
    items, conts = lockups(initial(html))
    seen = set()
    while conts:
        tok = conts.pop()
        if tok in seen:
            continue
        seen.add(tok)
        d = json.loads(get(f"https://www.youtube.com/youtubei/v1/browse?key={key}",
                           {"context": {"client": {"clientName": "WEB", "clientVersion": ver, "hl": "ko"}}, "continuation": tok}))
        more, c2 = lockups(d)
        items += more
        conts += c2
        time.sleep(0.3)
    return items


# 1) 채널 재생목록
pls = browse_all("https://www.youtube.com/@PRS/playlists")
book_pl = {}
for cid, typ, title in pls:
    m = re.match(r"^\s*(\d+)\.\s*(.+?)_장별 구절 영상", title or "")
    if m:
        book_pl[m.group(2).strip()] = (int(m.group(1)), cid)
print("재생목록", len(book_pl), file=sys.stderr)

# 2) 재생목록마다 영상
videos, problems = {}, []
for book, (n, pid) in sorted(book_pl.items(), key=lambda x: x[1][0]):
    items = browse_all(f"https://www.youtube.com/playlist?list={pid}")
    time.sleep(1)
    got = 0
    for vid, typ, title in items:
        if (typ and "VIDEO" not in typ) or not title:
            continue
        m = re.search(r"(\d+)\s*[장편]", title)
        if not m:
            problems.append((book, title))
            continue
        key = f"{book} {int(m.group(1))}"
        if key not in videos:
            videos[key] = vid
            got += 1
    print(n, book, got, file=sys.stderr)

# 재생목록에 빠져 있는 장 (같은 채널에서 검색해 찾음)
FIXES = {"열왕기상 8": "toUAODNwVZg", "잠언 5": "gzjhTvI24Z4", "스가랴 12": "bljtiMdI6TE"}
for k, v in FIXES.items():
    videos.setdefault(k, v)

json.dump({"playlists": {b: p for b, (n, p) in book_pl.items()}, "videos": videos, "problems": problems},
          open(OUT, "w"), ensure_ascii=False, indent=0)
