export const project={id:'p-001',title:'$6 Handpowered Washer',channel:'DIY Survival',status:'in_production',duration:'3:42',resolution:'1080p',cost:1.8,estimatedCost:2.1,created:'Heute, 15:12',updated:'Heute, 16:42',research:{topic:'Hand-powered washing machine for under $10',audience:'DIY / Survival',angle:'Build a functional washer for under six dollars.',targetLength:'4–5 min',summary:'A practical low-cost build using simple materials.',sources:['DIY build reference','Portable washer comparison','PVC fitting guide'],approved:true},script:{version:3,wordCount:648,approved:true,humanized:true,text:'Imagine doing laundry anywhere, anytime. Most portable washers are expensive and unreliable. Here’s how I built a powerful one for under six dollars. You’ll need a bucket, PVC pipe, a few fittings and a hand crank. Let’s start by drilling holes into the bucket bottom.'},voiceover:{voice:'Adam',model:'ElevenLabs',version:2,duration:'3:42',status:'Ready',approved:true},timestamps:{status:'Ready',format:'SRT + JSON',scenes:16,approved:true},edit:{roughCut:'Ready',fineCut:'Not started',timeline:'Remotion project',approved:false}};
export const stages=[
{n:'01',key:'research',name:'Research',state:'done',meta:'Research doc',artifact:'Research document'},
{n:'02',key:'script',name:'Script',state:'done',meta:'v3 · 648 W',artifact:'Approved script v3'},
{n:'03',key:'scenes',name:'Scenes',state:'active',meta:'16 scenes',artifact:'Scene breakdown'},
{n:'04',key:'voiceover',name:'Voiceover',state:'done',meta:'3:42 · v2',artifact:'Audio v2'},
{n:'05',key:'timestamps',name:'Timestamps',state:'done',meta:'16 mapped',artifact:'SRT + JSON'},
{n:'06',key:'visuals',name:'Visuals',state:'warn',meta:'13/16 ready',artifact:'16 scene assets'},
{n:'07',key:'edit',name:'Edit',state:'blocked',meta:'Needs visuals',artifact:'Remotion render'}
];
const baseScenes=[
['Imagine doing laundry anywhere, anytime...','Close-up of hands turning a hand-crank on a homemade washer.','Slow push-in, natural light, focus on mechanism.','Fertig','AI'],
['Most portable washers are expensive and unreliable.','Expensive portable washers on store shelf with price tags.','Static shot, slight pan across price tags.','Fertig','Stock'],
['Here’s how I built a powerful one for under six dollars.','Parts and materials laid out on a wooden table.','Top-down shot, light movement in.','In Prüfung','AI'],
['You’ll need a bucket, PVC pipe, a few fittings and a hand crank.','Bucket, PVC pipe and fittings on table.','Static top-down shot.','Fertig','AI'],
['Let’s start by drilling holes into the bucket bottom.','Drilling holes into the bucket bottom.','Close-up, slight handheld.','Offen','AI'],
['The holes let water circulate while the crank creates movement.','Water circulating inside a DIY bucket washer.','Slow overhead movement.','Fertig','AI'],
['The crank connects to a simple PVC shaft.','PVC shaft and hand crank connection.','Slow orbit around the mechanism.','Fertig','AI'],
['Keep the shaft centered so the motion stays smooth.','Centered shaft inside a plastic bucket lid.','Macro detail, gentle push-in.','Fertig','AI'],
['Add a small handle so you can turn it comfortably.','Handmade crank handle being attached.','Handheld close-up.','Fertig','AI'],
['A few minutes of turning creates strong agitation.','Clothes moving in soapy water inside the washer.','Overhead, circular motion.','Fertig','AI'],
['The entire build costs less than a restaurant meal.','Materials and final washer with simple price labels.','Slow pull-back reveal.','In Prüfung','AI'],
['And every part can be replaced with common hardware.','Hardware-store style selection of PVC fittings.','Pan across parts.','Fertig','Stock'],
['Fill the bucket, add detergent and your clothes.','Hands loading clothes and detergent into the washer.','Top-down, smooth movement.','Fertig','AI'],
['Turn the crank steadily for a few minutes.','Person turning the crank outdoors.','Medium shot, subtle handheld.','Fertig','AI'],
['Drain, rinse, and repeat with clean water.','Clean water draining from the washer.','Close-up, slow tilt.','Fertig','AI'],
['That’s a working hand-powered washer for about six dollars.','Finished DIY washer beside clean laundry.','Hero reveal, slow push-out.','Fertig','AI']
];
const times=['00:00 – 00:08','00:08 – 00:17','00:17 – 00:29','00:29 – 00:45','00:45 – 01:01','01:01 – 01:14','01:14 – 01:27','01:27 – 01:41','01:41 – 01:55','01:55 – 02:10','02:10 – 02:25','02:25 – 02:39','02:39 – 02:55','02:55 – 03:12','03:12 – 03:28','03:28 – 03:42'];
const durations=['0:08','0:09','0:12','0:16','0:16','0:13','0:13','0:14','0:14','0:15','0:15','0:14','0:16','0:17','0:16','0:14'];
const images=['https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&w=800&q=75','https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=800&q=75','https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&w=800&q=75','https://images.unsplash.com/photo-1581147036324-c17ac41c7b8d?auto=format&fit=crop&w=800&q=75','https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=75','https://images.unsplash.com/photo-1581579185169-2c3c0a7d6b43?auto=format&fit=crop&w=800&q=75'];
export const scenes=baseScenes.map((s,i)=>({id:i+1,time:times[i],dur:durations[i],nar:s[0],ip:s[1],mp:s[2],status:s[3],source:s[4],approved:s[3]==='Fertig',img:images[i%6]}));
export const activity=[['16:42','Waiting for visual approval','amber'],['16:41','Scene 03 and 11 marked for review','amber'],['16:38','Motion prompts generated · 16 scenes','green'],['16:36','Image prompts generated · 16 scenes','green'],['16:35','Scene breakdown generated','green']];
export const dashboardProjects=[{title:'$6 Handpowered Washer',stage:'Visuals',detail:'3 scenes need approval',status:'amber',action:'Review'},{title:'Greek Envoys 481 BC',stage:'Voiceover',detail:'Provider timeout',status:'red',action:'Retry'},{title:'Off-Grid Water Filter',stage:'Edit',detail:'Ready to render',status:'green',action:'Render'}];
