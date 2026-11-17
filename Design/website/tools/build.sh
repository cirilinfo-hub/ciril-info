set -e
cd /home/claude/site
esbuild src/index.jsx --bundle --format=iife --global-name=__CXH --minify --target=es2019 --outfile=build/hx.js --log-level=warning
esbuild src/hx.css --minify --outfile=build/hx.css --log-level=warning
python3 patch.py >/dev/null
python3 -c "
s=open('index.html').read(); a=s.index('<script type=\"module\">')+len('<script type=\"module\">'); b=s.index('</script>',a); open('/tmp/claude-0/m.mjs','w').write(s[a:b])"
node --check /tmp/claude-0/m.mjs && echo BUILD-OK
