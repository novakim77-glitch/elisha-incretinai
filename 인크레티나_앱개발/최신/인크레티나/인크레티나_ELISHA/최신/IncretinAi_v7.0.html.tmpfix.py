import io
p="../../IncretinAi_v7.0_Adaptive.html"
with io.open(p,"r",encoding="utf-8") as f:
    s=f.read()

# Find the broken multi-line msg= block (lines 3975-3979 area).
# We replace any 6-line block starting with "            msg=" containing raw newlines
# by collapsing it into a single line with literal \n escape sequences.
import re
pat=re.compile(
    r"            msg=[\"']서버 응답이 8초 내에 없었어요\.[\s\S]*?linkCodes 쓰기 권한 확인[\"'];"
)
replacement = (
    "            msg='서버 응답이 8초 내에 없었어요.' + "
    "String.fromCharCode(10,10) + '• 네트워크 상태 확인' + "
    "String.fromCharCode(10) + '• Service Worker 캐시 삭제 후 새로고침' + "
    "String.fromCharCode(10) + '• Firestore 보안규칙에서 linkCodes 쓰기 권한 확인';"
)
new_s, n = pat.subn(replacement, s)
print("replacements:", n)
assert n == 1
with io.open(p,"w",encoding="utf-8") as f:
    f.write(new_s)
print("OK")
