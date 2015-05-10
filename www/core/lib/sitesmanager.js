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

.constant('mmCoreSitesStore', 'sites')
.constant('mmCoreCurrentSiteStore', 'current_site')

.config(function($mmAppProvider, mmCoreSitesStore, mmCoreCurrentSiteStore) {
    var stores = [
        {
            name: mmCoreSitesStore,
            keyPath: 'id'
        },
        {
            name: mmCoreCurrentSiteStore,
            keyPath: 'id'
        }
    ];
    $mmAppProvider.registerStores(stores);
})

/**
 * Sites manager service.
 *
 * @module mm.core
 * @ngdoc service
 * @name $mmSitesManager
 */
.factory('$mmSitesManager', function($http, $q, $mmSite, md5, $mmLang, $mmConfig, $mmApp, $mmWS, $mmUtil, $mmFS,
                                     $cordovaNetwork, mmCoreSitesStore, mmCoreCurrentSiteStore, $log) {

    $log = $log.getInstance('$mmSitesManager');

    var self = {},
        services = {},
        db = $mmApp.getDB(),
        sessionRestored = false;

    /**
     * Get the demo data of the siteurl if it is a demo site.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#getDemoSiteData
     * @param  {String} siteurl URL of the site to check.
     * @return {Promise}        Promise to be resolved with the site data if it's a demo site.
     *                          If it's not a demo site, the promise is rejected.
     */
    self.getDemoSiteData = function(siteurl) {
        return $mmConfig.get('demo_sites').then(function(demo_sites) {
            if (typeof(demo_sites) !== 'undefined' && typeof(demo_sites[siteurl]) !== 'undefined') {
                return demo_sites[siteurl];
            } else {
                return $q.reject();
            }
        });
    };

    /**
     * Check if a site is valid and if it has specifics settings for authentication
     * (like force to log in using the browser).
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#checkSite
     * @param {String} siteurl  URL of the site to check.
     * @param {String} protocol Protocol to use. If not defined, use https.
     * @return {Promise}        A promise to be resolved when the site is checked. Resolve params:
     *                            {
     *                                code: Authentication code.
     *                                siteurl: Site url to use (might have changed during the process).
     *                            }
     */
    self.checkSite = function(siteurl, protocol) {

        var deferred = $q.defer();

        // formatURL adds the protocol if is missing.
        siteurl = $mmUtil.formatURL(siteurl);

        if (siteurl.indexOf('://localhost') == -1 && !$mmUtil.isValidURL(siteurl)) {
            $mmLang.translateErrorAndReject(deferred, 'mm.login.invalidsite');
        } else {

            protocol = protocol || "https://";

            // Now, replace the siteurl with the protocol.
            siteurl = siteurl.replace(/^http(s)?\:\/\//i, protocol);

            self.siteExists(siteurl).then(function() {

                checkMobileLocalPlugin(siteurl).then(function(code) {
                    deferred.resolve({siteurl: siteurl, code: code});
                }, function(error) {
                    deferred.reject(error);
                });

            }, function(error) {
                // Site doesn't exist.

                if (siteurl.indexOf("https://") === 0) {
                    // Retry without HTTPS.
                    self.checkSite(siteurl, "http://").then(deferred.resolve, deferred.reject);
                } else{
                    $mmLang.translateErrorAndReject(deferred, 'mm.core.cannotconnect');
                }
            });

        }

        return deferred.promise;

    };

    /**
     * Check if a site exists.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#siteExists
     * @param  {String} siteurl URL of the site to check.
     * @return {Promise}        A promise to be resolved if the site exists.
     */
    self.siteExists = function(siteurl) {
        return $http.head(siteurl + '/login/token.php', {timeout: 15000});
    };

    /**
     * Check if the local_mobile plugin is installed in the Moodle site.
     * This plugin provide extended services.
     *
     * @param  {String} siteurl The Moodle SiteURL.
     * @return {Promise}        Promise to be resolved if the local_mobile plugin is installed. The promise is resolved
     *                          with an authentication code to identify the authentication method to use.
     */
    function checkMobileLocalPlugin(siteurl) {

        var deferred = $q.defer();

        $mmConfig.get('wsextservice').then(function(service) {

            $http.post(siteurl + '/local/mobile/check.php', {service: service} )
                .success(function(response) {
                    if (typeof(response.code) == "undefined") {
                        $mmLang.translateErrorAndReject(deferred, 'mm.core.unexpectederror');
                        return;
                    }

                    var code = parseInt(response.code, 10);
                    if (response.error) {
                        switch (code) {
                            case 1:
                                // Site in maintenance mode.
                                $mmLang.translateErrorAndReject(deferred, 'mm.login.siteinmaintenance');
                                break;
                            case 2:
                                // Web services not enabled.
                                $mmLang.translateErrorAndReject(deferred, 'mm.login.webservicesnotenabled');
                                break;
                            case 3:
                                // Extended service not enabled, but the official is enabled.
                                deferred.resolve(0);
                                break;
                            case 4:
                                // Neither extended or official services enabled.
                                $mmLang.translateErrorAndReject(deferred, 'mm.login.mobileservicesnotenabled');
                                break;
                            default:
                                $mmLang.translateErrorAndReject(deferred, 'mm.core.unexpectederror');
                        }
                    } else {
                        services[siteurl] = service; // No need to store it in DB.
                        deferred.resolve(code);
                    }
                })
                .error(function(data) {
                    deferred.resolve(0);
                });

        }, function() {
            deferred.resolve(0);
        });

        return deferred.promise;
    };

    /**
     * Gets a user token from the server.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#getUserToken
     * @param {String} siteurl   The site url.
     * @param {String} username  User name.
     * @param {String} password  Password.
     * @param {Boolean} retry    We are retrying with a prefixed URL.
     * @return {Promise}         A promise to be resolved when the token is retrieved.
     */
    self.getUserToken = function(siteurl, username, password, retry) {
        retry = retry || false;
        var deferred = $q.defer();

        determineService(siteurl).then(function(service) {

            var loginurl = siteurl + '/login/token.php';
            var data = {
                username: username,
                password: password,
                service: service
            };

            $http.post(loginurl, data).success(function(response) {

                if (typeof(response.token) != 'undefined') {
                    deferred.resolve(response.token);
                } else {

                    if (typeof(response.error) != 'undefined') {
                        // We only allow one retry (to avoid loops).
                        if (!retry && response.errorcode == "requirecorrectaccess") {
                            siteurl = siteurl.replace("https://", "https://www.");
                            siteurl = siteurl.replace("http://", "http://www.");
                            logindata.siteurl = siteurl;

                            self.getUserToken(siteurl, username, password, true).then(deferred.resolve, deferred.reject);
                        } else {
                            deferred.reject(response.error);
                        }
                    } else {
                        $mmLang.translateErrorAndReject(deferred, 'mm.login.invalidaccount');
                    }
                }
            }).error(function(data) {
                $mmLang.translateErrorAndReject(deferred, 'mm.core.cannotconnect');
            });

        }, deferred.reject);

        return deferred.promise;
    };

    /**
     * Add a new site to the site list and authenticate the user in this site.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#newSite
     * @param {String} siteurl  The site url.
     * @param {String} token    User's token.
     * @return {Promise}        A promise to be resolved when the site is added and the user is authenticated.
     */
    self.newSite = function(siteurl, token) {
        var deferred = $q.defer();

        // Use a candidate site until the site info is retrieved and validated.
        $mmSite.setCandidateSite(siteurl, token);

        $mmSite.fetchSiteInfo().then(function(infos) {
            if (isValidMoodleVersion(infos.functions)) {
                var siteid = md5.createHash(siteurl + infos.username);
                self.addSite(siteid, siteurl, token, infos);
                $mmSite.setSite(siteid, siteurl, token, infos);
                self.login(siteid);
                deferred.resolve();
            } else {
                $mmLang.translateErrorAndReject(deferred, 'mm.login.invalidmoodleversion');
                $mmSite.deleteCandidateSite();
            }
        }, function(error) {
            deferred.reject(error);
            $mmSite.deleteCandidateSite();
        });

        return deferred.promise;
    }

    /**
     * Function for determine which service we should use (default or extended plugin).
     *
     * @param  {String} siteurl The site URL.
     * @return {String}         The service shortname.
     */
    function determineService(siteurl) {
        // We need to try siteurl in both https or http (due to loginhttps setting).

        var deferred = $q.defer();

        // First http://
        siteurl = siteurl.replace("https://", "http://");
        if (services[siteurl]) {
            deferred.resolve(services[siteurl]);
            return deferred.promise;
        }

        // Now https://
        siteurl = siteurl.replace("http://", "https://");
        if (services[siteurl]) {
            deferred.resolve(services[siteurl]);
            return deferred.promise;
        }

        // Return default service.
        $mmConfig.get('wsservice').then(deferred.resolve, deferred.reject);

        return deferred.promise;
    };

    /**
     * Check for the minimum required version. We check for WebServices present, not for Moodle version.
     * This may allow some hacks like using local plugins for adding missing functions in previous versions.
     *
     * @param {Array} sitefunctions List of functions of the Moodle site.
     * @return {Boolean}            True if the moodle version is valid, false otherwise.
     */
    function isValidMoodleVersion(sitefunctions) {
        for(var i = 0; i < sitefunctions.length; i++) {
            if (sitefunctions[i].name.indexOf("component_strings") > -1) {
                return true;
            }
        }
        return false;
    };

    /**
     * Saves a site in local DB.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#addSite
     * @param {String} id      Site ID.
     * @param {String} siteurl Site URL.
     * @param {String} token   User's token in the site.
     * @param {Object} infos   Site's info.
     */
    self.addSite = function(id, siteurl, token, infos) {
        db.insert(mmCoreSitesStore, {
            id: id,
            siteurl: siteurl,
            token: token,
            infos: infos
        });
    };

    /**
     * Login a user to a site from the list of sites.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#loadSite
     * @param {String} siteid ID of the site to load.
     * @return {Promise}      Promise to be resolved when the site is loaded.
     */
    self.loadSite = function(siteid) {
        $log.debug('Load site '+siteid);
        return db.get(mmCoreSitesStore, siteid).then(function(site) {
            $mmSite.setSite(siteid, site.siteurl, site.token, site.infos);
            self.login(siteid);
        });
    };

    /**
     * Delete a site from the sites list.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#deleteSite
     * @param {String} siteid ID of the site to delete.
     * @return {Promise}      Promise to be resolved when the site is deleted.
     */
    self.deleteSite = function(siteid) {
        $log.debug('Delete site '+siteid);
        return $mmSite.deleteSite(siteid).then(function() {
            return db.remove(mmCoreSitesStore, siteid);
        });
    };

    /**
     * Check if there are no sites stored.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#hasNoSites
     * @return {Promise} Promise to be resolved if there are no sites, and rejected if there is at least one.
     */
    self.hasNoSites = function() {
        return db.count(mmCoreSitesStore).then(function(count) {
            if (count > 0) {
                return $q.reject();
            }
        });
    };

    /**
     * Check if there are sites stored.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#hasSites
     * @return {Promise} Promise to be resolved if there is at least one site, and rejected if there aren't.
     */
    self.hasSites = function() {
        return db.count(mmCoreSitesStore).then(function(count) {
            if (count == 0) {
                return $q.reject();
            }
        });
    };

    /**
     * Get the list of sites stored.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#getSites
     * @return {Promise} Promise to be resolved when the sites are retrieved.
     */
    self.getSites = function() {
        return db.getAll(mmCoreSitesStore).then(function(sites) {
            var formattedSites = [];
            angular.forEach(sites, function(site) {
                formattedSites.push({
                    id: site.id,
                    siteurl: site.siteurl,
                    fullname: site.infos.fullname,
                    sitename: site.infos.sitename,
                    avatar: site.infos.userpictureurl
                });
            });
            return formattedSites;
        });
    };

    /**
     * DANI: I don't like this function in here, but it's the only service that has the needed data.
     * Maybe a new service?
     *
     * This function downloads a file from Moodle. If the file is already downloaded, the function replaces
     * the www reference with the internal file system reference
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#getMoodleFilePath
     * @param  {String} fileurl The file path (usually a url).
     * @return {Promise}        Promise to be resolved with the downloaded URL.
     */
    self.getMoodleFilePath = function (fileurl, courseId, siteId) {

        // This function is used in regexp callbacks, better not to risk!!
        if (!fileurl) {
            return $q.reject();
        }

        if (!courseId) {
            courseId = 1;
        }

        if (!siteId) {
            siteId = $mmSite.getId();
            if (typeof(siteId) === 'undefined') {
                return $q.reject();
            }
        }

        return db.get(mmCoreSitesStore, siteId).then(function(site) {

            var downloadURL = $mmUtil.fixPluginfileURL(fileurl, site.token);
            var extension = "." + fileurl.split('.').pop();
            if (extension.indexOf(".php") === 0) {
                extension = "";
            }

            var filename = md5.createHash(fileurl) + extension;

            var path = {
                directory: siteId + "/" + courseId,
                file:      siteId + "/" + courseId + "/" + filename
            };

            return $mmFS.getFile(path.file).then(function(fileEntry) {
                // We use toInternalURL so images are loaded in iOS8 using img HTML tags,
                // with toURL the OS is unable to find the image files.
                $log.debug('File ' + downloadURL + ' already downloaded.');
                return fileEntry.toInternalURL();
            }, function() {
                try { // Use try/catch because $cordovaNetwork fails in Chromium (until mm.emulator is migrated).
                    if ($cordovaNetwork.isOnline()) {
                        $log.debug('File ' + downloadURL + ' not downloaded. Lets download.');
                        return $mmWS.downloadFile(downloadURL, path.file).then(function(fileEntry) {
                            return fileEntry.toInternalURL();
                        }, function(err) {
                            return downloadURL;
                        });
                    } else {
                        $log.debug('File ' + downloadURL + ' not downloaded, but the device is offline.');
                        return downloadURL;
                    }
                } catch(err) {
                    $log.debug('File ' + downloadURL + ' not downloaded, but cordova is not available.');
                    return downloadURL;
                }

            });
        });
    };

    /**
     * Login the user in a site.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#login
     * @param  {String} siteid ID of the site the user is accessing.
     */
    self.login = function(siteid) {
        db.insert(mmCoreCurrentSiteStore, {
            id: 1,
            siteid: siteid
        });
    };

    /**
     * Logout the user.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#logout
     * @return {Promise} Promise to be resolved when the user is logged out.
     */
    self.logout = function() {
        $mmSite.logout();
        return db.remove(mmCoreCurrentSiteStore, 1);
    }

    /**
     * Restores the session to the previous one so the user doesn't has to login everytime the app is started.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#restoreSession
     * @return {Promise} Promise to be resolved if a session is restored.
     */
    self.restoreSession = function() {
        if (sessionRestored) {
            return $q.reject();
        }
        sessionRestored = true;

        return db.get(mmCoreCurrentSiteStore, 1).then(function(current_site) {
            var siteid = current_site.siteid;
            $log.debug('Restore session in site '+siteid);
            return self.loadSite(siteid);
        });
    };

    /**
     * Gets the URL of a site. If no site is specified, return the URL of the current site.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmSitesManager#getSiteURL
     * @param  {String} siteid ID of the site.
     * @return {Promise}       Promise to be resolved with the URL of the site. This promise is never rejected.
     */
    self.getSiteURL = function(siteid) {
        var deferred = $q.defer();

        if (typeof(siteid) === 'undefined') {
            deferred.resolve($mmSite.getURL());
        } else {
            db.get(mmCoreSitesStore, siteid).then(function(site) {
                deferred.resolve(site.siteurl);
            }, function() {
                deferred.resolve(undefined);
            });
        }

        return deferred.promise;
    };

    return self;

});
