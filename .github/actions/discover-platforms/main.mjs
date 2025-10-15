import core from '@actions/core';
import github from '@actions/github';
import axios from 'axios';
import path from 'node:path';
import { strict as assert } from 'node:assert';

const token = core.getInput('password', {required: true});
const packageName = core.getInput('package-name', {required: true});
const platformFiles = core.getInput('platform-files', {required: true});

const octokit = github.getOctokit(token);

let platforms = {};
let missingPlatforms = [];

core.startGroup('🔍 Debug Context');
core.info(`Working dir: ${process.cwd()}`);
core.info(`Repo: ${github.context.repo.owner}/${github.context.repo.repo}`);
core.info(`Ref: ${github.context.ref}`);
core.info(`Platform files input: ${core.getInput('platform-files', { required: true })}`);
core.endGroup();


async function imageLabelExists(hexhash) {
   const resp = await axios.head(`https://ghcr.io/v2/${github.context.repo.owner.toLowerCase()}/${packageName}/manifests/${hexhash}`, {validateStatus:null, headers:{"Authorization":`Bearer ${Buffer.from(token).toString('base64')}`}});
   switch(resp.status) {
      case 404:
         return false;
      case 200:
         return true;
      default:
         throw new Error(`Getting package manifest resulted in status ${resp.status}`);
   }
}

async function doOneFile(file, target) {
   const {data} = await octokit.rest.repos.getContent({owner:github.context.repo.owner, repo:github.context.repo.repo, path:file, ref:github.context.ref});
   if(Array.isArray(data)) {
      let directoryPromises = [];
      for(const f of data) {
         if(f.type == 'file')
            directoryPromises.push(doOneFile(f.path, target));
      }
      return Promise.all(directoryPromises);
   }

   const filehash = data.sha;
   const filename = path.parse(file).name;
   platforms[filename] = {
      file: file,
      target: target,
      image: `ghcr.io/${github.context.repo.owner.toLowerCase()}/${packageName}:${filehash}`
   };
   if(await imageLabelExists(filehash) == false)
      missingPlatforms.push(filename);
}

try {
   const files = platformFiles.split(/[ \n]/).filter(Boolean);
   assert(files.length, "No platform files defined");

   let queryPromises = [];
   for(const file of files) {
      const file_and_target = file.split(':', 2);
      queryPromises.push(doOneFile(file_and_target[0], file_and_target[1] ?? ''));
   }

   await Promise.all(queryPromises);

   assert(Object.keys(platforms).length, "No platform files found");

   //The 'none' platform is used to give the build matrix a size of 1 when it would otherwise be 0, since that seems to
   // confuse actions, and skipping the build matrix causes some weird side effects with downstream dependent jobs
   if(missingPlatforms.length == 0)
      missingPlatforms.push('none');

   core.setOutput('platforms', JSON.stringify(platforms));
   core.setOutput('platform-list', JSON.stringify(Object.keys(platforms)));
   core.setOutput('missing-platforms', JSON.stringify(missingPlatforms));
} catch(error) {
   core.setFailed(error.message);
}