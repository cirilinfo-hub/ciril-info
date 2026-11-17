import re,sys
src=open('orig.html').read()
js=open('build/hx.js').read()
css=open('build/hx.css').read()
def rep(s,a,b,count=1):
    n=s.count(a)
    assert n==count, (a[:80], n)
    return s.replace(a,b)
# 1. CSS after the design-system/site stylesheet
src=rep(src,'</style>\n<div id="root"></div>','</style>\n<style id="hx-styles">'+css+'</style>\n<div id="root"></div>')
# 2. Bridge + bundle right before the app renders
bridge='window.__CXD={React:j,Link:Me,NavLink:au,useLocation:yt,useNavigate:hi,Outlet:Um,Seo:wt,PageHero:dn,SectionHead:we,Reveal:F,Faq:mi,CtaBand:Wr,ButtonLink:ke,Crumbs:vg,Brand:Wd,ScrollTop:jg};\n'
src=rep(src,'const kv=Bm;Cd(document.getElementById("root")).render(', bridge+js+'\nconst kv=Bm;Cd(document.getElementById("root")).render(')
# 3. Routes: admin as a sibling layout route, hosting pages inside the site layout
src=rep(src,'children:i.jsx(Hm,{children:i.jsxs(He,{element:i.jsx(kg,{}),children:[',
            'children:i.jsx(Hm,{children:[__CXH.adminRoute(He),i.jsxs(He,{element:i.jsx(kg,{}),children:[...__CXH.siteRoutes(He),')
src=rep(src,'i.jsx(He,{path:"*",element:i.jsx(yv,{})})]})})})}','i.jsx(He,{path:"*",element:i.jsx(yv,{})})]},"site")]})})}')
# 4. Main nav
src=rep(src,'{label:"Our Work",to:"/our-work"}','{label:"Hosting",to:"/hosting"},{label:"Pricing",to:"/pricing"},{label:"Our Work",to:"/our-work"}')
# 5. Footer: Hosting column + Admin link
src=rep(src,'i.jsxs("div",{children:[i.jsx("h2",{children:"Contact"}),',
  'i.jsxs("div",{children:[i.jsx("h2",{children:"Hosting"}),i.jsx("ul",{children:__CXH.siteFooterLinks().filter((e,t)=>t<9).map(e=>i.jsx("li",{children:i.jsx(Me,{to:e.to,children:e.label})},e.to))})]}),i.jsxs("div",{children:[i.jsx("h2",{children:"Contact"}),')
src=rep(src,'children:"Terms and Conditions"})})]','children:"Terms and Conditions"})}),i.jsx("li",{children:i.jsx(Me,{to:"/admin",children:"Admin Portal"})})]')
open('index.html','w').write(src)
print(len(src))
