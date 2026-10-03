const fs=require('node:fs');
fs.mkdirSync('dist',{recursive:true});
for(const file of ['index.html','app.js','styles.css'])fs.copyFileSync(file,`dist/${file}`);
let html=fs.readFileSync('index.html','utf8');
html=html.replace('<link rel="stylesheet" href="styles.css" />',()=>`<style>${fs.readFileSync('styles.css','utf8')}</style>`);
html=html.replace('<script src="app.js"></script>',()=>`<script>${fs.readFileSync('app.js','utf8')}</script>`);
fs.writeFileSync('GO_Project_Planner_Standalone.html',html);
fs.writeFileSync('dist/GO_Project_Planner_Standalone.html',html);
