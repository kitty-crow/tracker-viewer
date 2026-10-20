'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('./runtime-tracker.cjs');

test('runtime scan discovers a newly created workbook, then switches when a newer file appears', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'tracker-live-'));
  const original = process.env.TRACKER_FOLDER;
  try {
    const folder = path.join(root,'public'); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(root,'.env'),'TRACKER_FOLDER="./public"\n');
    assert.equal(runtime.latestTracker({root}),null);
    const first = path.join(folder,'Weekly Projects Tracker (2026-10-19).xlsx');
    fs.writeFileSync(first,'original tracker');
    assert.equal(runtime.latestTracker({root}).name,path.basename(first));
    const second = path.join(folder,'Weekly Projects Tracker (2026-10-26).xlsx');
    fs.writeFileSync(second,'new tracker');
    const later = new Date(Date.now()+120000);fs.utimesSync(second,later,later);
    fs.writeFileSync(path.join(folder,'~$Temporary.xlsx'),'temporary');
    fs.writeFileSync(path.join(folder,'latest-tracker.xlsx'),'older staged copy');
    assert.equal(runtime.latestTracker({root}).name,path.basename(second));
    assert.equal(runtime.latestTracker({root}).size,'new tracker'.length);
  } finally {
    if (original === undefined) delete process.env.TRACKER_FOLDER;
    else process.env.TRACKER_FOLDER=original;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('scanner uses an explicitly configured folder outside public', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-config-'));
  const original=process.env.TRACKER_FOLDER;
  try {
    const folder=path.join(root,'custom');fs.mkdirSync(folder);
    fs.writeFileSync(path.join(root,'.env'),'TRACKER_FOLDER="./custom"\n');
    fs.writeFileSync(path.join(folder,'Custom.xlsx'),'workbook');
    delete process.env.TRACKER_FOLDER;
    assert.equal(runtime.latestTracker({root}).name,'Custom.xlsx');
  } finally {
    if(original===undefined)delete process.env.TRACKER_FOLDER;else process.env.TRACKER_FOLDER=original;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
