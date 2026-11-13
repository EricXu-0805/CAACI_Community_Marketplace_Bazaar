from pathlib import Path
from markdown_it import MarkdownIt
import html, os, re
root=Path(__file__).resolve().parent.parent
sources=[root/'PLAN.md',root/'VERIFICATION.md',*sorted((root/'handoff').glob('*.md')),*sorted((root/'research').glob('*.md')),*sorted((root/'release').glob('*.md'))]
def target(p):
 return p.with_name('plan.html' if p.name=='PLAN.md' else 'verification.html' if p.name=='VERIFICATION.md' else p.stem+'.html')
css='''*{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#292b26;font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{padding:16px 4vw;border-bottom:1px solid #deded5;background:#fff;display:flex;gap:22px;align-items:center;flex-wrap:wrap}header strong{margin-right:auto}a{color:#94472e;text-underline-offset:4px}header a{text-decoration:none;font-size:14px}main{max-width:1120px;margin:36px auto 70px;background:white;border:1px solid #e0e1d8;padding:40px 48px;border-radius:9px}h1{font-size:30px;line-height:1.45;margin:0 0 20px}h2{margin-top:42px;font-size:23px;border-bottom:1px solid #ecece5;padding-bottom:9px}h3{font-size:19px;margin-top:28px}table{border-collapse:collapse;font-size:14px;line-height:1.7;display:block;overflow:auto;max-width:100%;margin:22px 0}th,td{border:1px solid #dddfd6;padding:12px 14px;vertical-align:top;min-width:140px}th{background:#f3f3eb;text-align:left}code{background:#f3f3ed;padding:2px 5px;font-size:.87em;overflow-wrap:anywhere}pre{padding:16px;background:#f3f3ed;overflow:auto;line-height:1.6}pre code{padding:0}li{margin:7px 0}img{max-width:100%;height:auto}footer{max-width:1120px;margin:0 auto 40px;color:#707168;padding:0 24px;font-size:13px}@media(max-width:700px){header{gap:12px;padding:13px 18px}header strong{width:100%}main{margin:14px 10px 36px;padding:25px 19px}h1{font-size:25px}h2{font-size:21px}body{font-size:15px}td,th{min-width:130px}}@media print{body{background:white}header,footer{display:none}main{border:0;padding:0;margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}table{display:table;font-size:10px}td,th{min-width:0;padding:7px}}'''
md=MarkdownIt('commonmark',{'html':False}).enable('table')
for src in sources:
 out=target(src); content=src.read_text(); body=md.render(content)
 def rewrite(m):
  value=html.unescape(m.group(1));path=value.split('#',1)[0]
  if not path or '://' in path or path.startswith('/') or not path.endswith('.md'):return m.group(0)
  resolved=(src.parent/path).resolve()
  if resolved in sources:
   new=os.path.relpath(target(resolved),out.parent)+('#'+value.split('#',1)[1] if '#' in value else '')
   return 'href="'+html.escape(new,quote=True)+'"'
  return m.group(0)
 body=re.sub(r'href="([^"]+)"',rewrite,body)
 nav=[('方案',root/'plan.html'),('平台研究',root/'research/PLATFORM_RESEARCH.html'),('OMO接手',root/'handoff/START_HERE.html'),('当前状态',root/'release/CURRENT_STATUS.html')]
 links=''.join('<a href="'+html.escape(os.path.relpath(p,out.parent))+'">'+name+'</a>' for name,p in nav)
 title=content.splitlines()[0].lstrip('# ')
 out.write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+' · V4</title><style>'+css+'</style></head><body><header><strong>Illini Market · 项目交接</strong>'+links+'<a href="https://illini-community-demo.vercel.app/">打开公开演示 ↗</a></header><main>'+body+'</main><footer>V4 · 2026-11-12 · <a href="'+html.escape(src.name)+'">Markdown 源文件</a> · 本地交接材料，不包含在公开 demo 内。</footer></body></html>')
print(f'Rendered {len(sources)} document pages')
