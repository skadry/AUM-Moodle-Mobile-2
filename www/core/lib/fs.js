// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.core')

/**
 * @ngdoc service
 * @name $mmFS
 * @module mm.core
 * @description
 * This service handles the interaction with the FileSystem.
 */
.factory('$mmFS', function($ionicPlatform, $cordovaFile, $log, $q) {

    $log = $log.getInstance('$mmFS');

    var self = {},
        initialized = false,
        basePath = '';

    // Formats to read a file.
    self.FORMATTEXT         = 0;
    self.FORMATDATAURL      = 1;
    self.FORMATBINARYSTRING = 2;
    self.FORMATARRAYBUFFER  = 3;

    /**
     * Initialize basePath based on the OS if it's not initialized already.
     *
     * @return {Promise} Promise to be resolved when the initialization is finished.
     */
    self.init = function() {

        var deferred = $q.defer();

        if (initialized) {
            deferred.resolve();
            return deferred.promise;
        }

        $ionicPlatform.ready(function() {

            if (ionic.Platform.isAndroid()) {
                basePath = cordova.file.externalApplicationStorageDirectory;
            } else if (ionic.Platform.isIOS()) {
                basePath = cordova.file.documentsDirectory;
            } else {
                $log.error('Error getting device OS.');
                deferred.reject();
                return;
            }

            initialized = true;
            $log.debug('FS initialized: '+basePath);
            deferred.resolve();
        });

        return deferred.promise;
    };

    /**
     * Get a file.
     *
     * @param  {String}  path Relative path to the file.
     * @return {Promise}      Promise to be resolved when the file is retrieved.
     */
    self.getFile = function(path) {
        return self.init().then(function() {
            $log.debug('Get file: '+path);
            return $cordovaFile.checkFile(basePath, path);
        });
    };

    /**
     * Get a directory.
     *
     * @param  {String}  path Relative path to the directory.
     * @return {Promise}      Promise to be resolved when the directory is retrieved.
     */
    self.getDir = function(path) {
        return self.init().then(function() {
            $log.debug('Get directory: '+path);
            return $cordovaFile.checkDir(basePath, path);
        });
    };

    /**
     * Create a directory or a file.
     *
     * @param  {Boolean} isDirectory  True if a directory should be created, false if it should create a file.
     * @param  {String}  path         Relative path to the dir/file.
     * @param  {Boolean} failIfExists True if it should fail if the dir/file exists, false otherwise.
     * @param  {String}  base         Base path to create the dir/file in. If not set, use basePath.
     * @return {Promise}              Promise to be resolved when the dir/file is created.
     */
    function create(isDirectory, path, failIfExists, base) {
        return self.init().then(function() {
            base = base || basePath;

            if (path.indexOf('/') == -1) {
                if (isDirectory) {
                    $log.debug('Create dir ' + path + ' in ' + base);
                    return $cordovaFile.createDir(base, path, !failIfExists);
                } else {
                    $log.debug('Create file ' + path + ' in ' + base);
                    return $cordovaFile.createFile(base, path, !failIfExists);
                }
            } else {
                // $cordovaFile doesn't allow creating more than 1 level at a time (e.g. tmp/folder).
                // We need to create them 1 by 1.
                var firstDir = path.substr(0, path.indexOf('/'));
                var restOfPath = path.substr(path.indexOf('/') + 1);

                $log.debug('Create dir ' + firstDir + ' in ' + base);

                return $cordovaFile.createDir(base, firstDir, true).then(function(newDirEntry) {
                    return create(isDirectory, restOfPath, failIfExists, newDirEntry.toURL());
                }, function(error) {
                    $log.error('Error creating directory ' + firstDir + ' in ' + base);
                    return $q.reject(error);
                });
            }
        });
    }

    /**
     * Create a directory.
     *
     * @param  {String}  path         Relative path to the directory.
     * @param  {Boolean} failIfExists True if it should fail if the directory exists, false otherwise.
     * @return {Promise}              Promise to be resolved when the directory is created.
     */
    self.createDir = function(path, failIfExists) {
        failIfExists = failIfExists || false; // Default value false.
        return create(true, path, failIfExists);
    };

    /**
     * Create a file.
     *
     * @param  {String}  path         Relative path to the file.
     * @param  {Boolean} failIfExists True if it should fail if the file exists, false otherwise..
     * @return {Promise}              Promise to be resolved when the file is created.
     */
    self.createFile = function(path, failIfExists) {
        failIfExists = failIfExists || false; // Default value false.
        return create(false, path, failIfExists);
    };

    /**
     * Removes a directory and all its contents.
     *
     * @param  {String}  path    Relative path to the directory.
     * @return {Promise}         Promise to be resolved when the directory is deleted.
     */
    self.removeDir = function(path) {
        return self.init().then(function() {
            $log.debug('Remove directory: ' + path);
            return $cordovaFile.removeRecursively(basePath, path);
        });
    };

    /**
     * Removes a file and all its contents.
     *
     * @param  {String}  path    Relative path to the file.
     * @return {Promise}         Promise to be resolved when the file is deleted.
     */
    self.removeFile = function(path) {
        return self.init().then(function() {
            $log.debug('Remove file: ' + path);
            return $cordovaFile.removeFile(basePath, path);
        });
    };

    /**
     * Retrieve the contents of a directory (not subdirectories).
     *
     * @param  {String} path Relative path to the directory.
     * @return {Promise}     Promise to be resolved when the contents are retrieved.
     */
    self.getDirectoryContents = function(path) {
        $log.debug('Get contents of dir: ' + path);
        return self.getDir(path).then(function(dirEntry) {

            var deferred = $q.defer();

            var directoryReader = dirEntry.createReader();
            directoryReader.readEntries(deferred.resolve, deferred.reject);

            return deferred.promise;
        });
    };

    /**
     * Calculate the size of a directory or a file.
     *
     * @param  {String} path Relative path to the directory or file.
     * @return {Promise}     Promise to be resolved when the size is calculated.
     */
    function getSize(entry) {

        var deferred = $q.defer();

        if (entry.isDirectory) {

            var directoryReader = entry.createReader();
            directoryReader.readEntries(function(entries) {

                var promises = [];
                for (var i = 0; i < entries.length; i++) {
                    promises.push(getSize(entries[i]));
                }

                $q.all(promises).then(function(sizes) {

                    var directorySize = 0;
                    for (var i = 0; i < sizes.length; i++) {
                        var fileSize = parseInt(sizes[i]);
                        if (isNaN(fileSize)) {
                            deferred.reject();
                            return;
                        }
                        directorySize += fileSize;
                    }
                    deferred.resolve(directorySize);

                }, deferred.reject);

            }, deferred.reject);

        } else if (entry.isFile) {
            entry.file(function(file) {
                deferred.resolve(file.size);
            }, deferred.reject);
        }

        return deferred.promise;
    }

    /**
     * Calculate the size of a directory.
     *
     * @param  {String} path Relative path to the directory.
     * @return {Promise}     Promise to be resolved when the size is calculated.
     */
    self.getDirectorySize = function(path) {
        $log.debug('Get size of dir: ' + path);
        return self.getDir(path).then(function(dirEntry) {
           return getSize(dirEntry);
        });
    };

    /**
     * Calculate the size of a file.
     *
     * @param  {String} path Relative path to the file.
     * @return {Promise}     Promise to be resolved when the size is calculated.
     */
    self.getFileSize = function(path) {
        $log.debug('Get size of file: ' + path);
        return self.getFile(path).then(function(fileEntry) {
           return getSize(fileEntry);
        });
    };

    /**
     * Calculate the free space in the disk.
     * TODO: Check if $cordovaFile.getFreeDiskSpace adapts to our needs. Does it calculate the space in
     * internal memory, sdcard or both?
     *
     * @param  {object} callBack        Success callback
     * @param  {object} errorCallback   Error Callback
     * @return {float}                  The estimated free space in bytes
     */
    self.calculateFreeSpace = function() {
        return $cordovaFile.getFreeDiskSpace();
    };

    /**
     * Normalize a filename that usually comes URL encoded.
     *
     * @param  {String} filename The file name.
     * @return {String}          The file name normalized.
     */
    self.normalizeFileName = function(filename) {
        filename = decodeURIComponent(filename);
        return filename;
    };

    /**
     * Read a file.
     *
     * @param  {String}  path   Relative path to the file.
     * @param  {Number}  format Format to read the file. By default, FORMATTEXT. Must be one of:
     *                                  $mmFS.FORMATTEXT
     *                                  $mmFS.FORMATDATAURL
     *                                  $mmFS.FORMATBINARYSTRING
     *                                  $mmFS.FORMATARRAYBUFFER
     * @return {Promise}        Promise to be resolved when the file is read.
     */
    self.readFile = function(path, format) {
        format = format || self.FORMATTEXT;
        $log.debug('Read file ' + path + ' with format '+format);
        switch (format) {
            case self.FORMATDATAURL:
                return $cordovaFile.readAsDataURL(basePath, path);
            case self.FORMATBINARYSTRING:
                return $cordovaFile.readAsBinaryString(basePath, path);
            case self.FORMATARRAYBUFFER:
                return $cordovaFile.readAsArrayBuffer(basePath, path);
            case self.FORMATTEXT:
            default:
                return $cordovaFile.readAsText(basePath, path);
        }
    };

    /**
     * Writes some data in a file.
     *
     * @param  {String}  path Relative path to the file.
     * @param  {String}  data Data to write.
     * @return {Promise}      Promise to be resolved when the file is written.
     */
    self.writeFile = function(path, data) {
        $log.debug('Write file: ' + path);
        return self.init().then(function() {
            return $cordovaFile.writeFile(basePath, path, data, true);
        });
    };

    /**
     * Gets a file that might be outside the app's folder.
     *
     * @param  {String}  fullPath Absolute path to the file.
     * @return {Promise}          Promise to be resolved when the file is retrieved.
     */
    self.getExternalFile = function(fullPath) {
        return $cordovaFile.checkFile(fullPath, '');
    };

    /**
     * Removes a file that might be outside the app's folder.
     *
     * @param  {String}  fullPath Absolute path to the file.
     * @return {Promise}          Promise to be resolved when the file is removed.
     */
    self.removeExternalFile = function(fullPath) {
        // removeFile(fullPath, '') does not work, we need to pass two valid parameters.
        var directory = fullPath.substring(0, fullPath.lastIndexOf('/') );
        var filename = fullPath.substr(fullPath.lastIndexOf('/') + 1);
        return $cordovaFile.removeFile(directory, filename);
    };

    /**
     * Get the base path where the application files are stored.
     *
     * @return {Promise} Promise to be resolved when the base path is retrieved.
     */
    self.getBasePath = function() {
        return self.init().then(function() {
            if (basePath.slice(-1) == '/') {
                return basePath;
            } else {
                return basePath + '/';
            }
        });
    };

    return self;
});
