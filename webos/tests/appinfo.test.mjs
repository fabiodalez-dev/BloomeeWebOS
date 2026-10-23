import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const appinfo=JSON.parse(readFileSync(new URL('../appinfo.json',import.meta.url),'utf8'));
// With handlesRelaunch, webOS leaves a Bloomee still running in the background behind
// the launcher when it is opened again, and PalmSystem.activate() from the relaunch
// event is ignored: the system must bring it to the front itself.
test('Bloomee lets webOS bring it to the front when it is launched again',()=>{assert.equal(appinfo.handlesRelaunch,undefined);});
