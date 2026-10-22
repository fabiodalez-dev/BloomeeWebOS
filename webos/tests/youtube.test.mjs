import {test} from 'node:test';import assert from 'node:assert/strict';import * as yt from '../youtube.js';
const runs=(...r)=>({runs:r.map(x=>typeof x==='string'?{text:x}:x)});
const artistRun=(name,id)=>({text:name,navigationEndpoint:{browseEndpoint:{browseId:id}}});
const thumbs=url=>({musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:url+'=w60-h60'},{url:url+'=w120-h120'}]}}});
const col=r=>({musicResponsiveListItemFlexColumnRenderer:{text:r}});
const song={musicResponsiveListItemRenderer:{thumbnail:thumbs('https://lh3/a'),playlistItemData:{videoId:'abcdefghijk'},
 flexColumns:[col(runs('Vivimi')),col(runs('Brano',' • ',artistRun('Laura Pausini','UCartist'),' • ',{text:'Resta in ascolto',navigationEndpoint:{browseEndpoint:{browseId:'MPREbalbum'}}},' • ','4:31'))]}};
const album={musicTwoRowItemRenderer:{title:runs('Io canto'),subtitle:runs('Album',' • ',artistRun('Laura Pausini','UCartist')),thumbnailRenderer:thumbs('https://lh3/b'),navigationEndpoint:{browseEndpoint:{browseId:'MPREbiocanto'}}}};
test('songs keep artist, album, duration and a TV-sized thumbnail',()=>{const it=yt.flatItems({contents:[song]})[0];
 assert.equal(it.kind,'song');assert.equal(it.videoId,'abcdefghijk');assert.deepEqual(it.artists,[{name:'Laura Pausini',id:'UCartist'}]);
 assert.deepEqual(it.album,{name:'Resta in ascolto',id:'MPREbalbum'});assert.equal(it.duration,271);assert.equal(it.thumbnail,'https://lh3/a=w320-h320');});
test('artist fallback ignores type labels, counts and durations in the subtitle',()=>{const r=JSON.parse(JSON.stringify(song));r.musicResponsiveListItemRenderer.flexColumns[1]=col(runs('Brano • Tiziano Ferro • 1,2 Mln di riproduzioni • 3:10'));
 const it=yt.flatItems({contents:[r]})[0];assert.deepEqual(it.artists,[{name:'Tiziano Ferro',id:null}]);assert.equal(it.duration,190);});
test('carousels and shelves become sections with their complete-list endpoints',()=>{
 const page={contents:[{musicCarouselShelfRenderer:{header:{musicCarouselShelfBasicHeaderRenderer:{title:runs({text:'Album',navigationEndpoint:{browseEndpoint:{browseId:'UCartist',params:'discography'}}})}},contents:[album]}},
  {musicShelfRenderer:{title:runs('Brani'),contents:[song],bottomEndpoint:{searchEndpoint:{query:'pausini',params:'songs'}}}}]};
 const [a,b]=yt.parseSections(page);
 assert.equal(a.title,'Album');assert.deepEqual(a.more,{browseId:'UCartist',params:'discography'});assert.equal(a.items[0].kind,'album');assert.equal(a.shelf,false);
 assert.equal(b.title,'Brani');assert.deepEqual(b.search,{query:'pausini',params:'songs'});assert.equal(b.shelf,true);});
test('the top search result card is the first item of its own section',()=>{
 const card={musicCardShelfRenderer:{title:runs({text:'Laura Pausini',navigationEndpoint:{browseEndpoint:{browseId:'UCartist'}}}),subtitle:runs('Artista'),thumbnail:thumbs('https://lh3/c'),contents:[song]}};
 const [s]=yt.parseSections({contents:[card]});assert.equal(s.title,'Risultato migliore');assert.deepEqual(s.items.map(i=>i.kind),['artist','song']);});
test('kinds follow YouTube Music browse ids',()=>{assert.equal(yt.kindOf('UCx'),'artist');assert.equal(yt.kindOf('MPREbx'),'album');for(const id of ['VLPLx','PLx','RDx','OLAKx'])assert.equal(yt.kindOf(id),'playlist');assert.equal(yt.kindOf('FEmusic_charts'),'other');});
test('continuations distinguish body tokens from legacy query tokens',()=>{
 assert.deepEqual(yt.continuation({a:[{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'new'}}}}]}),{token:'new',legacy:false});
 assert.deepEqual(yt.continuation({continuations:[{nextContinuationData:{continuation:'old'}}]}),{token:'old',legacy:true});
 assert.equal(yt.continuation({}),null);});
test('artist header gives listeners, subscribers, description and a large photo',()=>{
 const info=yt.artistInfo({header:{musicImmersiveHeaderRenderer:{title:runs('Laura Pausini'),monthlyListenerCount:runs('15 Mln ascoltatori mensili'),thumbnail:thumbs('https://lh3/d'),subscriptionButton:{subscribeButtonRenderer:{subscriberCountText:runs('1,7 Mln')}}}},
  contents:[{musicDescriptionShelfRenderer:{description:runs('Cantante italiana')}}]});
 assert.equal(info.name,'Laura Pausini');assert.equal(info.subscribers,'1,7 Mln');assert.equal(info.description,'Cantante italiana');assert.equal(info.banner,'https://lh3/d=w1200-h1200');});
test('album tracks inherit cover, artist and album from the header',()=>{
 const bare=JSON.parse(JSON.stringify(song));delete bare.musicResponsiveListItemRenderer.thumbnail;bare.musicResponsiveListItemRenderer.flexColumns.length=1;
 const page={header:{musicResponsiveHeaderRenderer:{title:runs('Io canto'),straplineTextOne:runs('Laura Pausini'),thumbnail:thumbs('https://lh3/e')}},contents:[bare,album]};
 const info=yt.collectionInfo(page),tracks=yt.fillCollectionTracks(yt.flatItems(page),info,'MPREbiocanto');
 assert.equal(tracks.length,1);assert.equal(tracks[0].thumbnail,'https://lh3/e=w544-h544');assert.deepEqual(tracks[0].artists,[{name:'Laura Pausini',id:null}]);assert.deepEqual(tracks[0].album,{name:'Io canto',id:'MPREbiocanto'});});
test('album artist comes from the strapline or channel links, never from the type and year',()=>{
 const bare=JSON.parse(JSON.stringify(song));delete bare.musicResponsiveListItemRenderer.thumbnail;bare.musicResponsiveListItemRenderer.flexColumns.length=1;
 const withSubtitle={header:{musicResponsiveHeaderRenderer:{title:runs('Io canto'),straplineTextOne:runs('Laura Pausini'),subtitle:runs('Album',' • ','2006'),thumbnail:thumbs('https://lh3/e')}},contents:[bare]};
 assert.deepEqual(yt.fillCollectionTracks(yt.flatItems(withSubtitle),yt.collectionInfo(withSubtitle),'MPREb1')[0].artists,[{name:'Laura Pausini',id:null}]);
 const linked={header:{musicDetailHeaderRenderer:{title:runs('Io canto'),subtitle:runs('Album',' • ',artistRun('Laura Pausini','UCp'),' • ','2006'),thumbnail:thumbs('https://lh3/e')}},contents:[bare]};
 assert.deepEqual(yt.fillCollectionTracks(yt.flatItems(linked),yt.collectionInfo(linked),'MPREb1')[0].artists,[{name:'Laura Pausini',id:'UCp'}]);
 const own=yt.fillCollectionTracks(yt.flatItems({contents:[song]}),yt.collectionInfo(linked),'VLx')[0];assert.deepEqual(own.artists,[{name:'Laura Pausini',id:'UCartist'}]);assert.equal(own.album.id,'MPREbalbum');});
test('queue tracks carry the video id, never a stream URL',()=>{const t=yt.toTrack(yt.flatItems({contents:[song]})[0]);
 assert.equal(t.source,'youtube');assert.equal(t.videoId,'abcdefghijk');assert.deepEqual(t.Artists,['Laura Pausini']);assert.equal(t.RunTimeTicks,271e7);assert.ok(!/googlevideo|http/.test(t.Id));});
test('account name comes from the active account header',()=>assert.equal(yt.accountName({actions:[{activeAccountHeaderRenderer:{accountName:runs('Fabio')}}]}),'Fabio'));
test('radio queue items become playable songs without duplicates',()=>{
 const item=(id)=>({playlistPanelVideoRenderer:{videoId:id,title:runs('Together Forever'),longBylineText:runs(artistRun('Rick Astley','UCrick'),' • ','2 Mln'),shortBylineText:runs('Rick Astley'),lengthText:runs('3:24'),thumbnail:{thumbnails:[{url:'https://i.ytimg.com/vi/x/hq.jpg'}]}}});
 const songs=yt.radio({contents:[item('aaaaaaaaaaa'),item('aaaaaaaaaaa'),item('bbbbbbbbbbb')]});
 assert.equal(songs.length,2);assert.deepEqual(songs[0].artists,[{name:'Rick Astley',id:'UCrick'}]);assert.equal(songs[0].duration,204);
 assert.equal(yt.toTrack(songs[0]).videoId,'aaaaaaaaaaa');});
test('references keep what favorites and pins need to reopen an item',()=>{
 const [s]=yt.flatItems({contents:[song]});const r=yt.toRef(s);
 assert.equal(r.kind,'track');assert.equal(r.id,'youtube::abcdefghijk');assert.equal(r.subtitle,'Laura Pausini');assert.equal(r.track.videoId,'abcdefghijk');
 const a=yt.toRef(yt.flatItems({contents:[album]})[0]);assert.equal(a.kind,'album');assert.equal(a.browseId,'MPREbiocanto');
 const withYear=yt.toRef(Object.assign({},yt.flatItems({contents:[album]})[0],{subtitle:'Album • Laura Pausini • 2006'}));assert.equal(withYear.year,2006);
 assert.equal(yt.toRef({kind:'other',title:'x',subtitle:'',artists:[]}),null);});
test('search pages carry their continuation',()=>{const p=yt.searchPage({contents:[song,{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'t'}}}}]});
 assert.equal(p.items.length,1);assert.deepEqual(p.next,{token:'t',legacy:false});});
