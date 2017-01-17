(function() {
    // retrieve button from the page
    var button = document.querySelector('button');
    var selfPacedContent = document.getElementById('selfpaced');

    // listen for a click on the search button
    button.addEventListener('click', function() {
        // unhide our next button,
        selfPacedContent.classList.remove('hidden');
        // update aria state
        selfPacedContent.setAttribute('aria-hidden', false);
        // notify addon that we've clicked the button
        addon.port.emit('intent', 'search');
        // main cta action complete, notify add-on
        addon.port.emit('cta_complete');
    });
})();
