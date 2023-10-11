
const logger = require("../helpers/logger").winstonLogger;
const utils = require('../helpers/utils');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const request = require('request');
var gitLastCommit = require('git-last-commit');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const { promisify } = require('util');
const getRepoInfo = require('git-repo-info');
const gitconfig = require('gitconfiglocal');
const { spawn, execSync } = require('child_process');
const glob = require('glob');
const pGitconfig = promisify(gitconfig);

exports.getFileSeparatorData = () => {
  return /^win/.test(process.platform) ? "\\" : "/";
}

exports.findGitConfig = (filePath) => {
  const fileSeparator = exports.getFileSeparatorData();
  if(filePath == null || filePath == '' || filePath == fileSeparator) {
    return null;
  }
  try {
    fs.statSync(filePath + fileSeparator + '.git' + fileSeparator + 'config');
    return filePath;
  } catch(e) {
    let parentFilePath = filePath.split(fileSeparator);
    parentFilePath.pop();
    return exports.findGitConfig(parentFilePath.join(fileSeparator));
  }
}

let packages = {};
exports.getPackageVersion = (package_, bsConfig = null) => {
  if(packages[package_]) return packages[package_];
  let packageVersion;
  /* Try to find version from module path */
  try {
    packages[package_] = this.requireModule(`${package_}/package.json`).version;
    logger.info(`Getting ${package_} package version from module path = ${packages[package_]}`);
    packageVersion = packages[package_];
  } catch(e) {
    logger.debug(`Unable to find package ${package_} at module path with error ${e}`);
  }

  /* Read package version from npm_dependencies in browserstack.json file if present */
  if(utils.isUndefined(packageVersion) && bsConfig && (process.env.BROWSERSTACK_AUTOMATION == "true" || process.env.BROWSERSTACK_AUTOMATION == "1")) {
    const runSettings = bsConfig.run_settings;
    if (runSettings && runSettings.npm_dependencies !== undefined && 
      Object.keys(runSettings.npm_dependencies).length !== 0 &&
      typeof runSettings.npm_dependencies === 'object') {
      if (package_ in runSettings.npm_dependencies) {
        packages[package_] = runSettings.npm_dependencies[package_];
        logger.info(`Getting ${package_} package version from browserstack.json = ${packages[package_]}`);
        packageVersion = packages[package_];
      }
    }
  }

  /* Read package version from project's package.json if present */
  const packageJSONPath = path.join(process.cwd(), 'package.json');
  if(utils.isUndefined(packageVersion) && fs.existsSync(packageJSONPath)) {
    const packageJSONContents = require(packageJSONPath);
    if(packageJSONContents.devDependencies && !utils.isUndefined(packageJSONContents.devDependencies[package_])) packages[package_] = packageJSONContents.devDependencies[package_];
    if(packageJSONContents.dependencies && !utils.isUndefined(packageJSONContents.dependencies[package_])) packages[package_] = packageJSONContents.dependencies[package_];
    logger.info(`Getting ${package_} package version from package.json = ${packages[package_]}`);
    packageVersion = packages[package_];
  }

  return packageVersion;
}

exports.getAgentVersion = () => {
  let _path = path.join(__dirname, '../../../package.json');
  if(fs.existsSync(_path))
    return require(_path).version;
}

exports.getGitMetaData = () => {
  return new Promise(async (resolve, reject) => {
    try {
      var info = getRepoInfo();
      if(!info.commonGitDir) {
        logger.debug(`Unable to find a Git directory`);
        resolve({});
      }
      if(!info.author && exports.findGitConfig(process.cwd())) {
        /* commit objects are packed */
        gitLastCommit.getLastCommit(async (err, commit) => {
          if(err) {
            logger.debug(`Exception in populating Git Metadata with error : ${err}`, true, err);
            return resolve({});
          }
          try {
            info["author"] = info["author"] || `${commit["author"]["name"].replace(/[“]+/g, '')} <${commit["author"]["email"].replace(/[“]+/g, '')}>`;
            info["authorDate"] = info["authorDate"] || commit["authoredOn"];
            info["committer"] = info["committer"] || `${commit["committer"]["name"].replace(/[“]+/g, '')} <${commit["committer"]["email"].replace(/[“]+/g, '')}>`;
            info["committerDate"] = info["committerDate"] || commit["committedOn"];
            info["commitMessage"] = info["commitMessage"] || commit["subject"];

            const { remote } = await pGitconfig(info.commonGitDir);
            const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName]['url']}));
            resolve({
              "name": "git",
              "sha": info["sha"],
              "short_sha": info["abbreviatedSha"],
              "branch": info["branch"],
              "tag": info["tag"],
              "committer": info["committer"],
              "committer_date": info["committerDate"],
              "author": info["author"],
              "author_date": info["authorDate"],
              "commit_message": info["commitMessage"],
              "root": info["root"],
              "common_git_dir": info["commonGitDir"],
              "worktree_git_dir": info["worktreeGitDir"],
              "last_tag": info["lastTag"],
              "commits_since_last_tag": info["commitsSinceLastTag"],
              "remotes": remotes
            });
          } catch(e) {
            logger.debug(`Exception in populating Git Metadata with error : ${e}`, true, e);
            return resolve({});
          }
        }, {dst: exports.findGitConfig(process.cwd())});
      } else {
        const { remote } = await pGitconfig(info.commonGitDir);
        const remotes = Object.keys(remote).map(remoteName =>  ({name: remoteName, url: remote[remoteName]['url']}));
        resolve({
          "name": "git",
          "sha": info["sha"],
          "short_sha": info["abbreviatedSha"],
          "branch": info["branch"],
          "tag": info["tag"],
          "committer": info["committer"],
          "committer_date": info["committerDate"],
          "author": info["author"],
          "author_date": info["authorDate"],
          "commit_message": info["commitMessage"],
          "root": info["root"],
          "common_git_dir": info["commonGitDir"],
          "worktree_git_dir": info["worktreeGitDir"],
          "last_tag": info["lastTag"],
          "commits_since_last_tag": info["commitsSinceLastTag"],
          "remotes": remotes
        });
      }
    } catch(err) {
      logger.debug(`Exception in populating Git metadata with error : ${err}`, true, err);
      resolve({});
    }
  })
}

exports.getCiInfo = () => {
  var env = process.env;
  // Jenkins
  if ((typeof env.JENKINS_URL === "string" && env.JENKINS_URL.length > 0) || (typeof env.JENKINS_HOME === "string" && env.JENKINS_HOME.length > 0)) {
    return {
      name: "Jenkins",
      build_url: env.BUILD_URL,
      job_name: env.JOB_NAME,
      build_number: env.BUILD_NUMBER
    }
  }
  // CircleCI
  if (env.CI === "true" && env.CIRCLECI === "true") {
    return {
      name: "CircleCI",
      build_url: env.CIRCLE_BUILD_URL,
      job_name: env.CIRCLE_JOB,
      build_number: env.CIRCLE_BUILD_NUM
    }
  }
  // Travis CI
  if (env.CI === "true" && env.TRAVIS === "true") {
    return {
      name: "Travis CI",
      build_url: env.TRAVIS_BUILD_WEB_URL,
      job_name: env.TRAVIS_JOB_NAME,
      build_number: env.TRAVIS_BUILD_NUMBER
    }
  }
  // Codeship
  if (env.CI === "true" && env.CI_NAME === "codeship") {
    return {
      name: "Codeship",
      build_url: null,
      job_name: null,
      build_number: null
    }
  }
  // Bitbucket
  if (env.BITBUCKET_BRANCH && env.BITBUCKET_COMMIT) {
    return {
      name: "Bitbucket",
      build_url: env.BITBUCKET_GIT_HTTP_ORIGIN,
      job_name: null,
      build_number: env.BITBUCKET_BUILD_NUMBER
    }
  }
  // Drone
  if (env.CI === "true" && env.DRONE === "true") {
    return {
      name: "Drone",
      build_url: env.DRONE_BUILD_LINK,
      job_name: null,
      build_number: env.DRONE_BUILD_NUMBER
    }
  }
  // Semaphore
  if (env.CI === "true" && env.SEMAPHORE === "true") {
    return {
      name: "Semaphore",
      build_url: env.SEMAPHORE_ORGANIZATION_URL,
      job_name: env.SEMAPHORE_JOB_NAME,
      build_number: env.SEMAPHORE_JOB_ID
    }
  }
  // GitLab
  if (env.CI === "true" && env.GITLAB_CI === "true") {
    return {
      name: "GitLab",
      build_url: env.CI_JOB_URL,
      job_name: env.CI_JOB_NAME,
      build_number: env.CI_JOB_ID
    }
  }
  // Buildkite
  if (env.CI === "true" && env.BUILDKITE === "true") {
    return {
      name: "Buildkite",
      build_url: env.BUILDKITE_BUILD_URL,
      job_name: env.BUILDKITE_LABEL || env.BUILDKITE_PIPELINE_NAME,
      build_number: env.BUILDKITE_BUILD_NUMBER
    }
  }
  // Visual Studio Team Services
  if (env.TF_BUILD === "True") {
    return {
      name: "Visual Studio Team Services",
      build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECTID}`,
      job_name: env.SYSTEM_DEFINITIONID,
      build_number: env.BUILD_BUILDID
    }
  }
  // if no matches, return null
  return null;
}