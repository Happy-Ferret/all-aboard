'use strict';

const CONTENT_STORE = {
    utility: [
        {
            id: 'allaboard-utility-content1',
            title: 'Searching'
        },
        {
            id: 'allaboard-utility-content2',
            title: 'Private Browsing'
        },
        {
            id: 'allaboard-utility-content3',
            title: 'Customizing'
        },
        {
            id: 'allaboard-utility-content4',
            title: 'History and Bookmarks'
        },
        {
            id: 'allaboard-utility-content5',
            title: 'Mobile'
        }
    ],
    values: [
        {
            id: 'allaboard-values-content1',
            title: 'Organization'
        },
        {
            id: 'allaboard-values-content2',
            title: 'Different'
        },
        {
            id: 'allaboard-values-content3',
            title: 'Privacy'
        },
        {
            id: 'allaboard-values-content4',
            title: 'Security'
        },
        {
            id: 'allaboard-values-content5',
            title: 'Community'
        }
    ]
};

var buttons = require('sdk/ui/button/action');
var notifications = require('sdk/notifications');
var pageMod = require('sdk/page-mod');
var self = require('sdk/self');
var sidebar = require('sdk/ui/sidebar');
var simpleStorage = require('sdk/simple-storage').storage;
var tabs = require('sdk/tabs');
var timers = require('sdk/timers');
var utils = require('lib/utils.js');
var windowUtils = require('sdk/window/utils');

var { Cu } = require('chrome');
var { XMLHttpRequest } = require('sdk/net/xhr');
var UITour = Cu.import('resource:///modules/UITour.jsm').UITour;
var LightweightThemeManager = Cu.import('resource://gre/modules/LightweightThemeManager.jsm').LightweightThemeManager;

// the browser window object where we can grab individual node (like the awesome bar)
var activeWindow = windowUtils.getMostRecentBrowserWindow();
// the awesomebar node from the browser window
var awesomeBar = activeWindow.document.getElementById('urlbar');
// whether we have assigned a token for our current content step
var assignedToken = false;
var aboutHome;
// Time to wait before auto closing the sidebar after user interaction
var afterInteractionCloseTime = 120000;
var allAboard;
var content;
var firstRun;
// the default interval between sidebars. Here set as hours.
var defaultSidebarInterval = 24;
// the time to wait before automatically closing the sidebar
var defaultSidebarCloseTime = 300000;
var firstrunRegex = /.*firefox[\/\d*|\w*\.*]*\/firstrun\//;
var hostnameMatch = /^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)(\/[^?#]*)(\?[^#]*|)(#.*|)$/;
// is the sidebar currently visible
var isVisible = false;
var sidebarProps;
var timeElapsedFormula = 1000*60*60;
// initialize timers to -1 to indicate that there are no timers currently running.
var timer = -1;
var destroyTimer = -1;
// 24 hours in milliseconds
var waitInterval = 86400000;
// 3 weeks in milliseconds
var nonuseDestroyTime = 1814400000;

/**
* Determines the number of hours that has elapsed since the last sidebar was shown.
* @param {string} sidebarLaunchTime - Time in milliseconds read from storage
* @returns The number of hours.
*/
function getTimeElapsed(sidebarLaunchTime) {
    var lastSidebarLaunch = new Date(sidebarLaunchTime);
    return Math.round((Date.now() - lastSidebarLaunch.getTime()) / (timeElapsedFormula));
}

/**
* Starts a timer that will call the showBadge function after 24 hours, should the
* user not close the browser earlier.
*/
function startTimer() {
    timer = timers.setInterval(function() {
        showBadge();
        timers.clearInterval(timer);
        timer = -1;
    }, waitInterval);
}

/**
 * Closes a currently visible sidebar after the defaultSidebarCloseTime
 * @param {boolean} clear - Inidcates whether to clear or start the timer.
 */
function autoCloseTimer(clear) {
    var autoClose;

    if (clear) {
        timers.clearTimeout(autoClose);
    } else {
        autoClose = timers.setTimeout(function() {
            if (isVisible) {
                content.hide();
            }
        }, defaultSidebarCloseTime);
    }
}

/**
* Utility function to set the desired size for the sidebar.
*/
function setSidebarSize() {
    var activeWindow = windowUtils.getMostRecentBrowserWindow();
    var _sidebar = activeWindow.document.getElementById('sidebar');
    _sidebar.style.width = '320px';
    _sidebar.style.maxWidth = '320px';
}

/**
* Shows a transient desktop notification to the user when new sidebar
* content is available. If the notification is clicked, the new sidebar is shown
* @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/SDK/High-Level_APIs/notifications
*/
function showDesktopNotification() {
    notifications.notify({
        title: 'Welcome Aboard',
        text: 'Firefox has something special for you.',
        iconURL: './media/icons/icon-32_active.png',
        onClick: toggleSidebar
    });
}

/**
* Updates the add-on icon by adding a badge, inicating that there is new content.
* This will also cause the desktop notification to be shown.
*/
function showBadge() {
    allAboard.state('window', {
        badge: '1',
        badgeColor: '#5F9B0A',
        icon: {
            '16': './media/icons/icon-16_active.png',
            '32': './media/icons/icon-32_active.png',
            '64': './media/icons/icon-64_active.png'
        }
    });
    showDesktopNotification();
}

/*
 * Opens the search bar
 */
function showSearch() {
    let activeWindow = windowUtils.getMostRecentBrowserWindow();
    let barPromise = UITour.getTarget(activeWindow, 'search');
    let iconPromise = UITour.getTarget(activeWindow, 'searchIcon');

    iconPromise.then(function(iconObj) {
        let searchIcon = iconObj.node;
        searchIcon.click();

        barPromise.then(function(barObj) {
            let searchbar = barObj.node;
            searchbar.updateGoButtonVisibility();
        });
    });
}

/**
 * Remove highlight and event listener on the awesomebar
 */
function removeHighlight() {
    UITour.hideHighlight(activeWindow);
    awesomeBar.removeEventListener('focus', removeHighlight);
}

/**
 * Highlight a given item in the browser chrome
 * @param {string} item - Item you wish to highlight's name as a string
 */
function highLight(item) {
    if (item === 'urlbar') {
        awesomeBar.addEventListener('focus', removeHighlight);
    }

    UITour.getTarget(activeWindow, item, false).then(function(chosenItem) {
        try {
            UITour.showHighlight(activeWindow, chosenItem, 'wobble');
        } catch(e) {
            console.error('Could not highlight element. Check if UITour.jsm supports highlighting of element passed.', e);
        }
    });
}

/**
 * Changes the theme based upon the value passed
 * @param {int} themeNum - a number passed based on the button clicked by the user
 */
function changeTheme(themeNum) {
    var personaIDs = [111387, 539838, 157076];

    // if there is no number passed, set the theme to default and return
    if (typeof themeNum === 'undefined') {
        LightweightThemeManager.themeChanged(null);
        return;
    }

    // start a new XMLHTTP request to get the theme JSON from AMO
    var personaRequest = new XMLHttpRequest();
    personaRequest.open('GET', 'https://versioncheck.addons.mozilla.org/en-US/themes/update-check/' + personaIDs[themeNum-1]);

    personaRequest.onload = function() {
        try {
            // get the theme JSON from the response
            var theme = JSON.parse(personaRequest.response);
            // set the theme
            LightweightThemeManager.themeChanged(theme);
        }
        catch(e) {
            console.error('Invalid Persona', e);
        }
    };

    personaRequest.send();
}

/**
* Grabs user history after auto-import happens
* and selects top 3 non-identical hostname history items, sorted by visit count
* @param {object} worker - used to emit browser history to the sidebar
*/
function getHistory(worker) {
    let { search } = require('sdk/places/history');

    let topHistory = [];
    let lastWeek = Date.now - (1000*60*60*24*7);

    try {
        search(
            { to: lastWeek},
            { count: 1000, sort: 'visitCount', descending: true}
            ).on('end', function (results) {
                // if we imported any browser history
                if (results) {
                    // search through to find history which fits our critera
                    for(var x = 0, y = results.length; x < y; x++) {
                        // if history has a title stored
                        if (results[x].title) {
                            // parse url
                            var parsedURL = results[x].url.match(hostnameMatch);
                            var duplicateHost = false;

                            // check if the current hostname is already in our top history
                            for(var z = 0, a = topHistory.length; z < a; z++) {
                                if (topHistory[z].indexOf(parsedURL[3]) !== -1) {
                                    duplicateHost = true;
                                }
                            }

                            // if the hostname isn't already in our top history, add this history element
                            if (!duplicateHost) {
                                // add element to the top history
                                topHistory.push('<a href=' + results[x].url + '>' + results[x].title + ' ' + results[x].visitCount +'</a><br><a class=\"hostname\">' + parsedURL[3] + '</a>');

                                // if we have the top 3 history elements which fit our parameters, break from the loop
                                if (topHistory.length >= 2) {
                                    break;
                                }
                            }
                        }
                    }

                }
                // send the top 3 history elements to the sidebar
                worker.port.emit('history', topHistory);
        });
    }
    catch (e) {
        console.error('Couldn\'t grab history: ', e);
    }
}

/**
* Grabs user bookmarks after auto-import happens
* and selects top 3 non-identical hostname bookmark items, sorted by date added
* @param {object} worker - used to emit browser bookmarks to the sidebar
*/
function getBookmarks(worker) {
    let { search } = require('sdk/places/bookmarks');
    let topBookmarks = [];

    try {
        search(
            { count: 20, sort: 'dateAdded', descending: true}
            ).on('end', function (results) {
                // if we have any bookmark data
                if (results) {
                    // search through each item
                    for(var x = 0, y = results.length; x < y; x++) {
                        if (results[x].title) {
                            // parse url
                            var parsedURL = results[x].url.match(hostnameMatch);
                            var duplicateHost = false;

                            // check if the current hostname is already in our top bookmark
                            for(var z = 0, a = topBookmarks.length; z < a; z++) {
                                if (topBookmarks[z].indexOf(parsedURL[3]) !== -1) {
                                    duplicateHost = true;
                                }
                            }

                            // if the hostname isn't already in our top bookmark, add this bookmark element
                            if (!duplicateHost) {
                                // add element to the top bookmark
                                topBookmarks.push('<a href=' + results[x].url + '>' + results[x].title + '</a><br><a class=\"hostname\">' + parsedURL[3] + '</a>');

                                // if we have the top 3 bookmark elements which fit our parameters, break from the loop
                                if (topBookmarks.length >= 2) {
                                    break;
                                }
                            }
                        }
                    }
                }
                // send the top 3 bookmark elements to the sidebar
                worker.port.emit('bookmarks', topBookmarks);
        });
    }
    catch (e) {
        console.error('Couldn\'t grab bookmarks: ', e);
    }
}

/**
* Manages tokens and emits a message to the sidebar with an array
* of tokens the user has received
* @param {int} step - the step to assign a token for
* @param {object} worker - used to emit the tokens array to the sidebar
*/
function assignTokens(step, worker) {
    let tokens = simpleStorage.tokens || [];
    let token = 'token' + step;
    // flag that we have assigned our token for this sidebar so we can check later
    assignedToken = true;

    // if the token is not currently in the array, add it
    if (tokens.indexOf(token) === -1) {
        tokens.push(token);
        // store the new token
        utils.store('tokens', tokens);
    }
    // emit the array of tokens to the sidebar
    worker.port.emit('tokens', tokens);

    // do not call the timer once we have reached
    // the final content item.
    if (step < 5) {
        // update the lastSidebarLaunchTime to now
        utils.store('lastSidebarLaunchTime', Date.now());
        // this code will not be called again prior to at least 24 hours
        // having elapsed, so it safe to simply call startTimer here.
        startTimer();
    }
}

/**
* Shows a sidebar for the current content step.
* @param {object} sidebarProps - properties for this sidebar instance
*/
function showSidebar(sidebarProps) {

    // if the sidebar is open, close it before calling show again
    // @see https://github.com/mozilla/all-aboard/issues/78 for details
    if (isVisible) {
        content.dispose();
    }

    content = sidebar.Sidebar({
        id: sidebarProps.id,
        title: sidebarProps.title,
        url: sidebarProps.url,
        onAttach: function(worker) {
            // listens to an intent message and calls the relevant function
            // based on intent.
            worker.port.on('intent', function(intent) {
                switch(intent) {
                    case 'search':
                        showSearch();
                        break;
                    case 'smarton':
                        tabs.open('https://www.mozilla.org/teach/smarton/security/');
                        break;
                    case 'newsletter':
                        tabs.open('https://www.mozilla.org/#newsletter-subscribe');
                        break;
                    case 'privateBrowsing':
                        highLight('privateWindow');
                        break;
                    case 'template1':
                        changeTheme(1);
                        break;
                    case 'template2':
                        changeTheme(2);
                        break;
                    case 'template3':
                        changeTheme(3);
                        break;
                    case 'defaultTemplate':
                        changeTheme();
                        break;
                    case 'highlightURL':
                        highLight('urlbar');
                        break;
                    // if the redeem sticker sidebar is shown anywhere other than within content, this will need to move with it
                    case 'stickerRedeemed':
                        startDestroyTimer(afterInteractionCloseTime);
                        break;
                    default:
                        break;
                }
            });

            // listen for events when a user completes a sidebar cta
            worker.port.on('cta_complete', function() {
                // anytime the user interacts with a sidebar, remove the previous 3 week destroy timer
                timers.clearInterval(destroyTimer);
                // start a new 3 week destroy timer
                startDestroyTimer(nonuseDestroyTime);

                // assign new token and notify sidebar as long as we haven't done so already
                if(!assignedToken) {
                    assignTokens(sidebarProps.step, worker);
                    timers.setTimeout(function() {
                        content.hide();
                        // clear the autoCloseTimer if it is running
                        autoCloseTimer(true);
                    }, afterInteractionCloseTime);
                }
            });

            // for the mobile sidebar, utility - content5, we assign a token
            // simply for opening the sidebar, no interaction required.
            if (sidebarProps.track === 'utility' && sidebarProps.step === 5) {
                assignTokens(sidebarProps.step, worker);
            }

            // store the current step we are on
            utils.store('step', sidebarProps.step);
            // update the distribution id with the current step
            utils.updatePref('-' + sidebarProps.step);
            // start the auto close timer
            autoCloseTimer();
        },
        onDetach: function() {
            if (content) {
                content.dispose();
                isVisible = false;
                // clear the current auto close timer
                autoCloseTimer(true);
            }
        },
        onHide: function() {
            isVisible = false;
        },
        onReady: function(worker) {
            // when the sidebar opens, and there are tokens in the list,
            // send it the current list of assigned tokens
            if (typeof simpleStorage.tokens !== 'undefined') {
                worker.port.emit('tokens', simpleStorage.tokens);
            }
        },
        onShow: function() {
            isVisible = true;
        }
    });

    content.show();
    setSidebarSize();
}

/**
 * Sets additional sidebar properties, step, track, url, and returns the result
 * @returns updated sidebarProps
 */
function getSidebarProps() {
    var track = simpleStorage.whatMatters;
    // we get the properties before we increment the contentStep as arrays are 0 indexed.
    var sidebarProps = CONTENT_STORE[track][simpleStorage.step || 0];
    // determine the current content step we are on
    var contentStep = typeof simpleStorage.step !== 'undefined' ? (simpleStorage.step + 1) : 1;
    // reset our assigned token flag for the new sidebar
    assignedToken = false;

    // store the current step
    utils.store('step', contentStep);

    // set the additional sidebar properties
    sidebarProps.step = contentStep;
    sidebarProps.track = track;
    sidebarProps.url = './tmpl/' + track + '/content' + contentStep + '.html';

    return sidebarProps;
}

/**
* Shows the next sidebar for the current track i.e. values or utility
*/
function toggleSidebar() {
    // anytime the user opens a sidebar, remove the previous 3 week destroy timer
    timers.clearInterval(destroyTimer);
    // start a new 3 week destroy timer
    startDestroyTimer(nonuseDestroyTime);

    // clears the badge and changes the icon back to a non-active state
    allAboard.state('window', {
        badge: null,
        icon: {
            '16': './media/icons/icon-16.png',
            '32': './media/icons/icon-32.png',
            '64': './media/icons/icon-64.png'
        }
    });

    // After the import data sidebar has been shown, 24 hours needs to elapse before
    // we start showing the content sidebars. If the add-on icon is clicked before this,
    // we need to simply show the import data sidebar again.
    if (typeof simpleStorage.step === 'undefined'
        && getTimeElapsed(simpleStorage.lastSidebarLaunchTime) < defaultSidebarInterval) {
        showImportDataSidebar();
        return;
    }

    // Ensure that we have not already shown all content items, that at least 24
    // hours have elapsed since we've shown the last sidebar, and that the user has
    // completed the main CTA for the current step before continuing to increment
    // the step counter and show the next sidebar.
    if (simpleStorage.step !== 5 && typeof simpleStorage.tokens !== 'undefined'
        && getTimeElapsed(simpleStorage.lastSidebarLaunchTime) >= defaultSidebarInterval
        && simpleStorage.tokens.indexOf('token' + simpleStorage.step) > -1) {
        // get the current sidebar's properties
        sidebarProps = getSidebarProps();
        // shows the relevant sidebar
        showSidebar(sidebarProps);
        // initialize the about:home pageMod
        modifyAboutHome(sidebarProps.track, sidebarProps.step);
    } else {
        // 24 hours has not elapsed since the last content sidebar has been shown so,
        // simply show or hide the current sidebar.
        if (isVisible) {
            content.hide();
        } else if (typeof sidebarProps !== 'undefined') {
            // We cannot just simply call .show(), because either the sidebar or
            // browser might have been closed which would have disposed of the
            // sidebar instance. Safest is to get a new instance.
            showSidebar(sidebarProps);
        } else {
            // this is the first time we are showing a content sidebar.
            sidebarProps = getSidebarProps();
            showSidebar(sidebarProps);
        }
    }
}

/**
* Shows the user data sidebar which provides the user with a button to
* open the newtab page, reset the auto-import, and view a preview of the data that was imported
*/
function showUserDataSidebar() {
    utils.store('lastSidebarLaunchTime', Date.now());

    content = sidebar.Sidebar({
        id: 'allboard-importdata',
        title: 'We\'ve got your back.',
        url: './tmpl/show_data.html',
        onAttach: function(worker) {
            getHistory(worker);
            getBookmarks(worker);
        },
        onDetach: function() {
            content.dispose();
            if (timer === -1) {
                startTimer();
            }
        }
    });

    content.show();
    setSidebarSize();
}

/**
* Shows the import data sidebar which provides the user with a button to
* start the migration wizard.
*/
function showImportDataSidebar() {

    utils.store('lastSidebarLaunchTime', Date.now());

    content = sidebar.Sidebar({
        id: 'allboard-importdata',
        title: 'Make Firefox your own',
        url: './tmpl/import_data.html',
        onAttach: function(worker) {
            worker.port.on('openMigrationTool', function() {
                // Imports the MigrationUtils needed to show the migration tool, and imports
                // Services, needed for the observer.
                // Note: Need to use the `chrome` module to do this which, according to the
                // docs should not really be done:
                // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/chrome
                Cu.import('resource:///modules/MigrationUtils.jsm');
                Cu.import('resource://gre/modules/Services.jsm');

                MigrationUtils.showMigrationWizard();

                Services.obs.addObserver(function() {
                    worker.port.emit('migrationCompleted');
                }, 'Migration:Ended', false);
            });
        },
        onDetach: function() {
            content.dispose();
            // starts the timer that will call showBadge and queue up the next
            // sidebar to be shown. Only start the timer if there is not one
            // already scheduled.
            if (timer === -1) {
                startTimer();
            }
        }
    });

    content.show();
    setSidebarSize();
}

/**
 * Modifies the about:home page to show a snippet that matches the current sidebar.
 * @param {string} track - The current sidebar's track
 * @param {int} step - The current sidebar's content step
 */
function modifyAboutHome(track, step) {
    aboutHome = pageMod.PageMod({
        include: /about:home/,
        contentScriptFile: './js/about-home.js',
        contentScriptWhen: 'ready',
        contentStyleFile: './css/about-home.css',
        onAttach: function(worker) {
            // constructs uri to snippet content
            var contentURL = './tmpl/' + track + '/content' + step + '-snippet.html';
            // load snippet HTML
            var snippetContent = self.data.load(contentURL);
            // emit modify event and passes snippet HTML as a string
            worker.port.emit('modify', snippetContent);

            // listens to an intent message and calls the relevant function
            // based on intent.
            worker.port.on('intent', function(intent) {
                switch(intent) {
                    case 'bookmarks':
                        highLight('bookmarks');
                        break;
                    case 'customize':
                        highLight('customize');
                        break;
                    case 'privateBrowsing':
                        highLight('privateWindow');
                        break;
                    case 'search':
                        showSearch();
                        break;
                    default:
                        break;
                }
            });
        }
    });
}

/**
* Modifies the /firstrun page
* http://regexr.com/3dbrq
* This will only have an effect if there is a DOM element with a class of .fxaccounts
*/
function modifyFirstrun() {

    firstRun = pageMod.PageMod({
        include: firstrunRegex,
        contentScriptFile: './js/firstrun.js',
        contentScriptWhen: 'ready',
        contentStyleFile: './css/firstrun.css',
        onAttach: function(worker) {
            var firstRunTmpl;
            var utility = self.data.load('./tmpl/fragments/what-matters-option1.html');
            var values = self.data.load('./tmpl/fragments/what-matters-option2.html');
            // generate a random number, 1 or 2
            var firstOption = Math.floor(Math.random() * 2) + 1 ;

            // depeding upon the random number, either set values option first, or utility option first
            if(firstOption === 2) {
                firstRunTmpl = self.data.load('./tmpl/firstrun.html').replace('%optionOne', values).replace('%optionTwo', utility);
            }
            else {
                firstRunTmpl = self.data.load('./tmpl/firstrun.html').replace('%optionOne', utility).replace('%optionTwo', values);
            }

            // because calling destroy does not unregister the injected script
            // we do not want the script to be self executing. We therefore intentionally
            // emit an event that tells the firstrun code to execute, we also pass the
            // template as a string.
            worker.port.emit('modify', firstRunTmpl);

            worker.port.on('dialogSubmit', function(choices) {
                utils.store('isOnBoarding', choices.isOnBoarding);
                utils.store('whatMatters', choices.whatMatters);
                utils.updatePref('-' + choices.whatMatters + '-' + choices.isOnBoarding);
            });

            // listens for a message from pageMod when a user clicks on "No thanks"
            worker.port.on('onboardingDismissed', function(dismissed) {
                // user has opted out of onboarding, destroy the addon
                destroy();
                utils.store('onboardingDismissed', dismissed);
            });

            // The code below will be executed once(1 time) when the user navigates away from the
            // firstrun page. This is when we need to show the import data sidebar, as well
            // as register a listener that will call modifyFirstrun if the user has not answered
            // the questions or dismissed onboarding
            tabs.once('ready', function() {
                // only register the tabs listener if both onboardingDismissed and
                // isOnBoarding are undefined.
                if (typeof simpleStorage.onboardingDismissed === 'undefined'
                    && typeof simpleStorage.isOnBoarding === 'undefined') {
                    tabs.on('ready', function() {
                        // besides ensuring that we are on the firstrun page,
                        // also ensure the above still holds true before calling modifyFirstrun
                        if (firstrunRegex.test(tabs.activeTab.url)
                            && simpleStorage.onboardingDismissed === 'undefined'
                            && typeof simpleStorage.isOnBoarding === 'undefined') {
                            modifyFirstrun();
                        }
                    });
                }

                // If the yup/nope question has been answered,
                // and the user is on a page other than /firstrun, we can safely destroy the
                // firstrun pageMod and show the import data sidebar.
                if (typeof simpleStorage.isOnBoarding !== 'undefined'
                    && !firstrunRegex.test(tabs.activeTab.url)) {
                    // destroy the pageMod as it is no longer needed
                    firstRun.destroy();
                    // show the sidebar
                    showImportDataSidebar();
                }
            });
        }
    });
}

/**
 * Overrides time interval defauls from config file.
 */
function overrideDefaults() {
    try {
        // load the config file
        let config = self.data.load('./../config.json');

        // if the file existed, parse the contents to a JSON object
        if (config) {
            config = JSON.parse(config);
            // override time intervals with values from config if they exist
            afterInteractionCloseTime = config.afterInteractionCloseTime || afterInteractionCloseTime;
            defaultSidebarInterval = config.defaultSidebarInterval || defaultSidebarInterval;
            defaultSidebarCloseTime = config.defaultSidebarCloseTime || defaultSidebarCloseTime;
            timeElapsedFormula = config.timeElapsedFormula || timeElapsedFormula;
            waitInterval = config.waitInterval || waitInterval;
            nonuseDestroyTime = config.nonuseDestroyTime || nonuseDestroyTime;
        }
    } catch(e) {
        console.error('Either no config.json file was created, or it was placed at the wrong location. Error:', e);
    }
}

/**
 * Starts the timer based upon the afterInteractionCloseTime to destroy the addon
 */
function startDestroyTimer(destroyTime) {
    destroyTimer = timers.setTimeout(function() {
        // clear the autoCloseTimer if it is running
        autoCloseTimer(true);
        // destroys the addon
        destroy();
    }, destroyTime);
}

/** This is called to explicitly 'uninstall' the addon, destroying functional
 *  pieces needed for user interaction, effectively removing the addon
 */
function destroy() {
    // removes the currently running timer, if one exists
    timers.clearInterval(timer);

    // removes the button from the UI, and disables its further use
    if(allAboard) {
        allAboard.destroy();
    }
    // stops pagemod from making more modifications on abouthome in the future, and disables its further use
    if(aboutHome) {
        aboutHome.destroy();
    }
    // stops pagemod from making more modifications on firstrun in the future, and disables its further use
    if(firstRun) {
        firstRun.destroy();
    }
    // destroys the addon sidebar, and disables its further use
    if(content) {
        content.dispose();
    }
}

/** This is called when the add-on is unloaded. If the reason is either disable,
 * or shutdown, we can do some cleanup.
 */
exports.onUnload = function(reason) {
    if (reason === 'disable' || reason === 'shutdown') {

        if (typeof aboutHome !== 'undefined') {
            aboutHome.destroy();
        }
    }
};

/**
* Initializes the add-on, adds the icon to the chrome and checks the time elapsed
* since a sidebar was last shown.
*/
exports.main = function(options) {
    // set's up the addon for dev mode.
    overrideDefaults();

    // if init was called as part of a browser startup, we first need to check
    // whether lastSidebarLaunchTime exists and if it does, check whether
    // more than 24 hours have elsapsed since the last time a sidebar was shown.
    if (options.loadReason === 'startup'
        && simpleStorage.lastSidebarLaunchTime !== 'undefined'
        && getTimeElapsed(simpleStorage.lastSidebarLaunchTime) > defaultSidebarInterval) {
        // if all of the above is true
        showBadge();
    }

    if (options.loadReason === 'startup') {
        // if the sidebar was open during Firefox shutdown, it will be shown by
        // default when Firefox is started up again. The sidebar will not be
        // sized appropriately though so, we call setSidebarSize
        setSidebarSize();
    }

    // Create the sidebar button, this will add the add-on to the chrome
    allAboard = buttons.ActionButton({
        id: 'all-aboard',
        label: 'Mozilla Firefox Onboarding',
        icon: {
            '16': './media/icons/icon-16.png',
            '32': './media/icons/icon-32.png',
            '64': './media/icons/icon-64.png'
        },
        onClick: toggleSidebar
    });

    // do not call modifyFirstrun again if the user has either opted out or,
    // already answered a questions(as both questions need to be answered, checking
    // for the first one is enough).
    if (typeof simpleStorage.onboardingDismissed === 'undefined'
        && typeof simpleStorage.isOnBoarding === 'undefined') {
        modifyFirstrun();
    }
};
