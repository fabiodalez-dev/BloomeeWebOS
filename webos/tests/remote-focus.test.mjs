import {test} from 'node:test';import assert from 'node:assert/strict';import {chooseRemoteTarget} from '../remote-focus.js';
const rect=(left,top,width=300,height=76)=>({left,top,width,height});
test('Down reaches the next settings row even when it is below the viewport',()=>{const b={element:'info',rect:rect(1300,1200)};assert.equal(chooseRemoteTarget(rect(1300,700),[b],'ArrowDown'),'info');});
test('remote selection moves through the inline options instead of trapping a native select',()=>{assert.equal(chooseRemoteTarget(rect(400,400),[{element:'next',rect:rect(750,400)},{element:'below',rect:rect(400,520)}],'ArrowRight'),'next');assert.equal(chooseRemoteTarget(rect(400,400),[{element:'next',rect:rect(750,400)},{element:'below',rect:rect(400,520)}],'ArrowDown'),'below');});
test('no directional candidate is preferable to jumping backwards',()=>assert.equal(chooseRemoteTarget(rect(400,400),[{element:'above',rect:rect(400,200)}],'ArrowDown'),null));
