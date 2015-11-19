var eventPages = (function() {
		var that = {};
		var initFn = function() {
			chrome.storage.sync.get("contentCensorData", function(item) {
				console.log("Content Censor requested existing data");
				console.log(item);
				if (item.contentCensorData == null) {
					console.log("The store is empty. Initiaizing with defaults.");
					chrome.storage.sync.set({
						"contentCensorData" : [{
							find : 'republican',
							replace : 'pervert',
							isRegex : false
						}, {
							find : 'tea party',
							replace : 'pervert',
							isRegex : false
						}, {
							find : "iPhone",
							replace : 'Abortion',
							isRegex : true
						}, {
							find : 'Republican',
							replace : 'Pervert',
							isRegex : false
						}, {
							find : 'Tea Party',
							replace : 'Rape Philosophy Party',
							isRegex : false
						}, {
							find : 'GOP',
							replace : 'CUNT',
							isRegex : false
						}]
					});
				} else {
					console.log("The store contains values.");
				}
			});

		};
		that.init = function() {
			console.log("Content Censor starting up");
			chrome.runtime.onInstalled.addListener(initFn);
			chrome.runtime.onStartup.addListener(initFn);
		};
		return that;
	}());

eventPages.init();