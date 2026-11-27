from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parent.parent
paths=[root/x for x in ['PLAN.md','plan.html','VERIFICATION.md','verification.html']]
for d in ['handoff','research','prototype','revisions/v3']:
 paths.extend(p for p in (root/d).rglob('*') if p.is_file() and not p.name.startswith('.'))
for name in ['CURRENT_STATUS.md','CURRENT_STATUS.html','P2_IMPLEMENTATION.md','P2_IMPLEMENTATION.html','P2_CI_FINDINGS.md','P2_CI_FINDINGS.html','PUBLISH_MANIFEST.json','PUBLIC_HTTP_CHECK.json','community-desktop.jpg','community-mobile.jpg','public-demo-desktop.jpg','build_document_portal.py','package_handoff.py']:
 p=root/'release'/name
 if p.exists():paths.append(p)
paths.extend(p for p in (root/'release/public-demo').rglob('*') if p.is_file())
paths.extend(p for p in (root/'release/p2-checks').rglob('*') if p.is_file())
paths=sorted(set(paths))
manifest={'date':'2026-11-12','version':4,'entry':'handoff/START_HERE.md','files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
m=root/'release/HANDOFF_FILES.json';m.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');paths.append(m)
archive=root.parent/'Illini-Community-OMO-V4-2026-11-12.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in paths:z.write(p,'Illini-Community-V4/'+str(p.relative_to(root)))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert not any('/sources/' in n or '/.env' in n for n in z.namelist())
print(json.dumps({'archive':str(archive),'files':len(paths),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},ensure_ascii=False))
