import fs from 'node:fs';
const html = fs.readFileSync('D:/LocalModels/server/app.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dup = Object.entries(ids.reduce((a,id)=>{a[id]=(a[id]||0)+1;return a;},{})).filter(([,n])=>n>1);
console.log('ids total', ids.length, 'dup', JSON.stringify(dup));
const need = ['cwNewLang','cwReviewModel','cwThink','cwThinkText','cwIssues','cwReviewState','cwFixAll','cwReReview','cwSendChat','cwColorErr','cwColorWarn','cwColorInfo','cwColorChanged','cwColorReset','cwReviewSummary','cwThinkSum'];
console.log('missing', need.filter(n=>!ids.includes(n)));
// check settings panes vs tabs
const tabs=[...html.matchAll(/class="stab[^"]*" data-tab="([^"]+)"/g)].map(m=>m[1]);
const panes=[...html.matchAll(/class="settingsBody" id="pane[^"]+" data-pane="([^"]+)"/g)].map(m=>m[1]);
console.log('tabs', tabs.join(','), 'panes', panes.join(','));
