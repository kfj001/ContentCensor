// This script will need to be refactored into multple counterparts.
// 1. A "lifetime" page, where registration will occur and retreive/create the values in the
// arrays. and 2. the script you see here that is executed on page views.

// SEE: Event pages in chrome extensions

// var toReplace = ['republican', 'tea party', /iPhone/gi, 'Republican', 'Tea Party', 'GOP'],
// replaceWith = ['pervert', 'rape philosophy party', 'Abortion', 'Pervert', 'Rape Philosophy Party', 'CUNT'];
var toReplace = [];
var replaceWith = [];

var replacementFn = function(parent) {
	if (parent.nodeType === parent.TEXT_NODE) {
		for (var i = 0; i < toReplace.length; i++) {
			parent.textContent = parent.textContent.replace(toReplace[i], replaceWith[i]);
		}
	} else {
		for (var i = 0; i < parent.childNodes.length; i++) {
			replacementFn(parent.childNodes[i]);
		}
	}
};

chrome.storage.sync.get("contentCensorData", function(items) {
	toReplace = $(items.contentCensorData).map(function() {
		return this.isRegex ? new RegExp(this.find, "gi") : this.find;
	});

	replaceWith = $(items.contentCensorData).map(function() {
		return this.replace;
	});

	$(document).on("body div").bind("DOMSubtreeModified", function() {
		replacementFn(document.body);
	});
	//replacementFn(document.body);
});
