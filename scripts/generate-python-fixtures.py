"""Run with sid-python/.venv/bin/python; normal builds do not need Python."""
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "sid-python"
REVISION = "c25f9299a90d17735473ca401ae45fa4b41e25d8"
assert subprocess.check_output(["git", "-C", str(REFERENCE), "rev-parse", "HEAD"], text=True).strip() == REVISION
sys.path.insert(0, str(REFERENCE))
from sid import DocumentCache, render_markdown_table
from sid._snippet import bm25_snippet_with_stride
from sid.document_cache import SUPPORTED_LANGUAGES

snippets = []
def snippet(name, query, content, window=4, stride=1, language="english"):
    span = bm25_snippet_with_stride(query, content, window, stride, language)
    snippets.append(dict(name=name, query=query, content=content,
                         options=dict(windowSize=window, stride=stride, language=language), span=span))

for case in json.loads((REFERENCE / "tests/fixtures/snippet_relevance.json").read_text()):
    snippet(case["name"], case["query"], case["content"], case["window_size"], case["stride"])
for language in SUPPORTED_LANGUAGES:
    snippet(language, "alpha und beta", "alpha beta und x x alpha und beta x x x x", language=language)
for i, content in enumerate(["😀 zero one café target three four", "e\u0301 zero one target three four", "漢字 zero one target three four", "ภาษาไทย zero one target three four", "日本語 中文 한국어 target more words here"]):
    snippet(f"unicode-{i}", "target", content, 3)
for query in ["", "the and", "missing"]:
    snippet(f"zero-score-{query}", query, "one two three four five six seven eight", 3)
snippet("final-window", "last", "zero one two three four five last", 3, 20)
snippet("short", "query", "one two", 50)
snippet("punctuation", "query", "!!! ...", 3)
snippet("empty-helper", "query", "", 3)
rng = random.Random(42)
for i in range(100):
    content = " ".join(rng.choice(["alpha", "βeta", "漢字", "😀", "the", "target", "e\u0301"]) for _ in range(80))
    snippet(f"random-{i}", "alpha target", content, 11, 3)

views = []
def rendered(name, document, options, *, seen=(), apply=False, cache_options=None):
    cache_options = cache_options or {}
    c = DocumentCache(**cache_options)
    mid = c.add_document("d", document)
    for span in seen:
        c.update_seen(c.get_single_span_document_view("d", "content", tuple(span)))
    py_names = dict(snippetField="snippet_field", snippetDisplaySpan="snippet_display_span", displayFields="display_fields", snippetSize="snippet_size", minSeenOverlap="min_seen_overlap")
    kwargs = {py_names.get(key, key): tuple(value) if key == "snippetDisplaySpan" else value for key, value in options.items()}
    v = c.apply_snippet("d", **kwargs) if apply else c.get_single_span_document_view("d", **kwargs)
    views.append(dict(name=name, document=document, options=options, seen=seen, apply=apply,
                      cacheOptions={"rangeMode" if key == "range_mode" else key: value for key, value in cache_options.items()},
                      xml=v.render_xml().replace(mid, "DOCID"), markdown=render_markdown_table([v]).replace(mid, "DOCID"),
                      displaySpans=v.snippet_display_spans))

document = dict(title='A "quote" <title> &', tags=["a", "b"], count=3, zero=0, no=False, yes=True, empty=[], content='😀 alpha e\u0301 bravo | charlie\ndelta')
rendered("whole-unicode", document, dict(snippetField="content"))
rendered("partial-unicode", document, dict(snippetField="content", snippetDisplaySpan=[3, 11]))
rendered("clamped", document, dict(snippetField="content", snippetDisplaySpan=[-5, 999]))
rendered("metadata-only", document, dict(displayFields=["title", "count", "zero", "no", "yes", "empty"]))
rendered("pure-repeat", document, dict(snippetField="content", query="alpha"), seen=[[0, len(document["content"])]], apply=True)
long = dict(title="T", content=" ".join(f"w{i:04d}" for i in range(100)))
rendered("seen-mask", long, dict(snippetField="content", query="w0090", snippetSize=200), seen=[[0, 150]], apply=True)
rendered("short-seen-reshown", long, dict(snippetField="content", query="w0090", snippetSize=200), seen=[[0, 50]], apply=True)
rendered("disjoint-seen", long, dict(snippetField="content", query="w0090", snippetSize=200, minSeenOverlap=10), seen=[[0, 50], [100, 200]], apply=True)
for language in SUPPORTED_LANGUAGES:
    rendered(f"view-{language}", dict(content="alpha beta und x x alpha und beta x x x x"), dict(snippetField="content", query="alpha und beta", snippetSize=4), apply=True, cache_options=dict(language=language))

destination = ROOT / "tests/fixtures/python-parity.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(dict(referenceRevision=REVISION, snippets=snippets, views=views), ensure_ascii=False, indent=2) + "\n")
print(f"Generated {len(snippets)} snippet cases and {len(views)} rendering cases")
