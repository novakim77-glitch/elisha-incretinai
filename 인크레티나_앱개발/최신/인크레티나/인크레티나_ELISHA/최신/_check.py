import io,re
with io.open('../../IncretinAi_v7.0_Adaptive.html','r',encoding='utf-8') as f: s=f.read()
blocks=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>',s)
print('inline blocks:',len(blocks))
BS='\\'
for bi,b in enumerate(blocks):
    lines=b.split('\n')
    in_str=False
    quote=None
    for li,line in enumerate(lines):
        i=0
        while i<len(line):
            ch=line[i]
            if not in_str:
                if ch in ("'",'"','`'):
                    in_str=True
                    quote=ch
            else:
                if ch==BS:
                    i+=2
                    continue
                if ch==quote:
                    in_str=False
                    quote=None
            i+=1
        if in_str and quote in ("'",'"'):
            print('  blk',bi,'line',li,'UNCLOSED',repr(quote),'->',line[-120:])
            in_str=False
            quote=None
print('done')
