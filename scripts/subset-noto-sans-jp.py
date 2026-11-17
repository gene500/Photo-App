# Builds public/fonts/NotoSansJP-Regular.ttf (about 2.2 MB, SIL OFL): the regular weight of the Google Fonts variable
# Noto Sans JP (https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf), subset to JIS X 0208
# level 1+2 kanji, kana, symbols, Latin/Greek/Cyrillic. Noto Sans JP itself lacks much of Latin Extended-A/B, Greek, Cyrillic and
# Latin Extended Additional, so a second stage merges those glyphs in from public/fonts/NotoSans-Regular.ttf (same 1000 upm; Noto
# Sans JP's own glyphs win where both have one). Not part of the build; needs fontTools (use a throwaway venv):
#   python3 -I scripts/subset-noto-sans-jp.py NotoSansJP-VF.ttf NotoSansJP-Regular.ttf public/fonts/NotoSans-Regular.ttf
# The intermediate Latin subset goes to a temporary directory that is removed afterwards (nothing extra is left next to the output).
# pdf-fonts.ts picks between this file and NotoSansSC by checking the file's cmap against the text, so no coverage table needs updating.
import os
import sys
import tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset, merge
src, out, latin = sys.argv[1], sys.argv[2], sys.argv[3]
f = TTFont(src)
print("glyf" in f, "CFF " in f, "fvar" in f)
f = instancer.instantiateVariableFont(f, {"wght": 400}, updateFontNames=True)
cps = set()
for row in range(0x21, 0x75):  # JIS X 0208 rows 1-84 (levels 1+2, symbols, kana, Greek, Cyrillic)
    for cell in range(0x21, 0x7f):
        try:
            ch = bytes([0x80 + row, 0x80 + cell]).decode("euc_jp")
            cps.add(ord(ch))
        except Exception: pass
cps |= set(range(0x20, 0x7f)) | set(range(0xa0, 0x250)) | set(range(0x370, 0x400)) | set(range(0x400, 0x530))
cps |= set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0x3040, 0x30a0)) | set(range(0x30a0, 0x3100))
cps |= set(range(0xff01, 0xff5f)) | set(range(0xff61, 0xffa0)) | {0x20ac, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193}
cps |= set(range(0x1ea0, 0x1f00)) | set(range(0x1e00, 0x1ea0))
opts = subset.Options()
opts.layout_features = ["kern", "liga"]
opts.name_IDs = [1, 2, 3, 4, 6, 0, 13, 14]
opts.notdef_outline = True
opts.hinting = False
opts.drop_tables += ["DSIG", "GPOS", "GSUB", "BASE", "vhea", "vmtx", "MVAR", "STAT", "HVAR"]
s = subset.Subsetter(opts)
s.populate(unicodes=sorted(cps))
s.subset(f)
f.save(out)

# Stage 2: add the Latin Extended / Greek / Cyrillic / punctuation glyphs the JP font lacks, taken from Noto Sans.
jp = TTFont(out)
ns = TTFont(latin)
have = set(jp.getBestCmap())
want = set(range(0x100, 0x250)) | set(range(0x370, 0x400)) | set(range(0x400, 0x530)) | set(range(0x1e00, 0x1f00)) | set(range(0x2000, 0x2070)) | set(range(0x20a0, 0x20d0))
missing = sorted((want & set(ns.getBestCmap())) - have)
o2 = subset.Options()
o2.layout_features = []
o2.hinting = False
o2.notdef_outline = False
o2.name_IDs = [1, 2, 3, 4, 6]
o2.drop_tables += ["GPOS", "GSUB", "GDEF", "STAT", "prep", "gasp", "DSIG", "MVAR", "HVAR"]
s2 = subset.Subsetter(o2)
s2.populate(unicodes=missing)
s2.subset(ns)
with tempfile.TemporaryDirectory() as tmp:
    latin_subset = os.path.join(tmp, "latin.ttf")
    ns.save(latin_subset)
    merge.Merger().merge([out, latin_subset]).save(out)
