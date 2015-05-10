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
 * Web service module.
 *
 * @module mm.core
 * @ngdoc service
 * @name $mmWS
 */
.factory('$mmWS', function($http, $q, $log, $mmLang, $cordovaFileTransfer, $cordovaNetwork, $mmFS) {

    $log = $log.getInstance('$mmWS');

    var self = {};

    /**
     * A wrapper function for a moodle WebService call.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmWS#call
     * @param {string} method The WebService method to be called.
     * @param {Object} data Arguments to pass to the method.
     * @param {Object} preSets Extra settings and information.
     *                    - siteurl string The site URL.
     *                    - wstoken string The Webservice token.
     *                    - wsfunctions array List of functions available on the site.
     *                    - responseExpected boolean (false) Raise an error if response is null.
     */
    self.call = function(method, data, preSets) {

        var deferred = $q.defer(),
            siteurl;

        data = convertValuesToString(data);

        if (typeof(preSets) === 'undefined' || preSets == null ||
                typeof(preSets.wstoken) === 'undefined' || typeof(preSets.siteurl) === 'undefined') {
            $mmLang.translateErrorAndReject(deferred, 'mm.core.unexpectederror');
            return deferred.promise;
        }
        try {
            if ($cordovaNetwork.isOffline()) {
                $mmLang.translateErrorAndReject(deferred, 'mm.core.networkerrormsg');
                return deferred.promise;
            }
        } catch(err) {}

        data.wsfunction = method;
        data.wstoken = preSets.wstoken;
        siteurl = preSets.siteurl + '/webservice/rest/server.php?moodlewsrestformat=json';

        var ajaxData = data;

        // TODO: Show error if not connected.
        $http.post(siteurl, ajaxData).then(function(data) {
            // Some moodle web services return null.
            // If the responseExpected value is set then so long as no data
            // is returned, we create a blank object.
            if (!data && !data.data && !preSets.responseExpected) {
                data = {};
            } else {
                data = data.data;
            }

            if (!data) {
                $mmLang.translateErrorAndReject(deferred, 'mm.core.cannotconnect');
                return;
            }

            if (typeof(data.exception) !== 'undefined') {
                if (data.errorcode == 'invalidtoken' || data.errorcode == 'accessexception') {
                    // TODO: Send an event to logout the user and redirect to login page.
                    $log.error("Critical error: " + JSON.stringify(data));
                    $mmLang.translateErrorAndReject(deferred, 'mm.core.lostconnection');
                } else {
                    deferred.reject(data.message);
                }
                return;
            }

            if (typeof(data.debuginfo) != 'undefined') {
                deferred.reject('Error. ' + data.message);
                return;
            }

            $log.info('WS: Data received from WS ' + typeof(data));

            if (typeof(data) == 'object' && typeof(data.length) != 'undefined') {
                $log.info('WS: Data number of elements '+ data.length);
            }

            // We pass back a clone of the original object, this may
            // prevent errors if in the callback the object is modified.
            deferred.resolve(angular.copy(data));

        }, function(error) {
            $mmLang.translateErrorAndReject(deferred, 'mm.core.cannotconnect');
        });

        return deferred.promise;
    };

    /**
     * Converts an objects values to strings where appropriate.
     * Arrays (associative or otherwise) will be maintained.
     *
     * @param {Object} data The data that needs all the non-object values set to strings.
     * @return {Object} The cleaned object, with multilevel array and objects preserved.
     */
    function convertValuesToString(data) {
        var result = [];
        if (!angular.isArray(data) && angular.isObject(data)) {
            result = {};
        }
        for (var el in data) {
            if (angular.isObject(data[el])) {
                result[el] = convertValuesToString(data[el]);
            } else {
                result[el] = data[el] + '';
            }
        }
        return result;
    };

    /**
     * Downloads a file from Moodle using Cordova File API.
     * @todo Use Web Workers.
     *
     * @param {String}   url        Download url.
     * @param {String}   path       Local path to store the file.
     * @param {Boolean}  background True if this function should be executed in background using Web Workers.
     * @return {Promise}            The success returns the fileEntry, the reject will contain the error object.
     */
    self.downloadFile = function(url, path, background) {
        $log.debug('Downloading file ' + url);

        return $mmFS.getBasePath().then(function(basePath) {
            var absolutePath = basePath + path;
            return $cordovaFileTransfer.download(url, absolutePath, { encodeURI: false }, true).then(function(result) {
                $log.debug('Success downloading file ' + url + ' to ' + absolutePath);
                return result;
            }, function(err) {
                $log.error('Error downloading ' + url + ' to ' + absolutePath);
                $log.error(JSON.stringify(err));
                return $q.reject(err);
            });
        });
    };

    /*
     * Uploads a file using Cordova File API.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmWS#uploadFile
     * @param {Object} uri File URI.
     * @param {Object} options File settings: fileKey, fileName and mimeType.
     * @param {Object} presets Contains siteurl and token.
     * @return {Promise}
     */
    self.uploadFile = function(uri, options, presets) {
        $log.info('Trying to upload file (' + uri.length + ' chars)');

        var ftOptions = {},
            deferred = $q.defer();

        ftOptions.fileKey = options.fileKey;
        ftOptions.fileName = options.fileName;
        ftOptions.httpMethod = 'POST';
        ftOptions.mimeType = options.mimeType;
        ftOptions.params = {
            token: presets.token
        };
        ftOptions.chunkedMode = false;
        ftOptions.headers = {
            Connection: "close"
        };

        $log.info('Initializing upload');
        $cordovaFileTransfer.upload(presets.siteurl + '/webservice/upload.php', uri, ftOptions).then(function(success) {
            $log.info('Successfully uploaded file');
            deferred.resolve(success);
        }, function(error) {
            $log.error('Error while uploading file: ' + error.exception);
            deferred.reject(error);
        }, function(progress) {
            deferred.notify(progress);
        });

        return deferred.promise;
    };

    return self;

});
