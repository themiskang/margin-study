import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

if (process.platform !== "darwin") process.exit(0);
const root=fileURLToPath(new URL("../../",import.meta.url)), source=join(root,"native/src/PhotoPicker.swift");
const app=join(root,"native/MarginStudy Photos.app"), contents=join(app,"Contents"), executable=join(contents,"MacOS/MarginStudyPhotos");
const hash=createHash("sha256").update(readFileSync(source)).update(process.arch+"photos-host-v2").digest("hex"), stamp=join(contents,"Resources/source-hash.txt");
if (existsSync(stamp)&&existsSync(executable)&&readFileSync(stamp,"utf8").trim()===hash) process.exit(0);
mkdirSync(join(contents,"MacOS"),{recursive:true});
mkdirSync(join(contents,"Resources"),{recursive:true});
if (existsSync(join(contents,"source-hash.txt"))) unlinkSync(join(contents,"source-hash.txt"));
writeFileSync(join(contents,"Info.plist"),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.marginstudy.photo-picker</string><key>CFBundleName</key><string>MarginStudy Photos</string><key>CFBundleExecutable</key><string>MarginStudyPhotos</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
execFileSync("/usr/bin/xcrun",["swiftc","-parse-as-library","-swift-version","5","-O","-target",`${process.arch==="arm64"?"arm64":"x86_64"}-apple-macosx13.0`,source,"-o",executable],{stdio:"inherit"});
writeFileSync(stamp,hash+"\n");
execFileSync("/usr/bin/codesign",["--force","--sign","-",app],{stdio:"inherit"});
console.log("Built native PhotosUI host (macOS 13+; "+process.arch+")");
