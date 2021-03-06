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

angular.module('mm.addons.participants')

/**
 * Service to handle course participants.
 *
 * @module mm.addons.participants
 * @ngdoc service
 * @name $mmaParticipants
 */
.factory('$mmaParticipants', function($q, $log, $mmSite, $mmUtil, mmaParticipantsListLimit, $mmLang, $mmUtil) {

    $log = $log.getInstance('$mmaParticipants');

    var self = {};

    /**
     * Get participants for a certain course.
     *
     * @module mm.addons.participants
     * @ngdoc method
     * @name $mmaParticipants#getParticipants
     * @param {String} courseid    ID of the course.
     * @param {Number} limitFrom   Position of the first participant to get.
     * @param {Number} limitNumber Number of participants to get.
     * @return {Promise}           Promise to be resolved when the participants are retrieved.
     */
    self.getParticipants = function(courseid, limitFrom, limitNumber) {

        if (typeof(limitFrom) === 'undefined') {
            limitFrom = 0;
        }
        if (typeof(limitNumber) === 'undefined') {
            limitNumber = mmaParticipantsListLimit;
        }

        $log.debug('Get participants for course ' + courseid + ' starting at ' + limitFrom);

        var data = {
            "courseid" : courseid,
            "options[0][name]" : "limitfrom",
            "options[0][value]": limitFrom,
            "options[1][name]" : "limitnumber",
            "options[1][value]": limitNumber,
        };

        return $mmSite.read('core_enrol_get_enrolled_users', data).then(function(users) {
            var canLoadMore = users.length >= limitNumber;
            return {participants: users, canLoadMore: canLoadMore};
        });
    };

    /**
     * Get a participant.
     *
     * @module mm.addons.participants
     * @ngdoc method
     * @name $mmaParticipants#getParticipant
     * @param  {String} courseid ID of the course the participant belongs to.
     * @param  {String} userid   ID of the participant.
     * @return {Promise}         Promise to be resolved when the participant is retrieved.
     */
    self.getParticipant = function(courseid, userid) {
        $log.debug('Get participant with ID ' + userid + ' in course '+courseid);
        var deferred = $q.defer();

        var data = {
            "userlist[0][userid]": userid,
            "userlist[0][courseid]": courseid
        };

        $mmSite.read('core_user_get_course_user_profiles', data).then(function(users) {
            if (users.length == 0) {
                $mmLang.translateErrorAndReject(deferred, 'errorparticipantnotfound');
                return;
            }

            $mmUtil.getCountries().then(function(countries) {

                var user = users.shift();

                if (user.country && typeof(countries) !== 'undefined'
                                 && typeof(countries[user.country]) !== "undefined") {
                    user.country = countries[user.country];
                }

                deferred.resolve(user);

            });
        }, deferred.reject);

        return deferred.promise;
    };

    return self;
});
