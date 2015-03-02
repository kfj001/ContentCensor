var pageScripts = ((function() {
		var that = {};
		var populateBoxes = function() {
			console.log("populating boxes");
			chrome.storage.sync.get("contentCensorData", function(items) {
				var index = 0;
				var findBoxes = $(".findField");
				var replaceBoxes = $(".replaceField");
				var checkBoxes = $("input[type=checkbox]");
				for (var item in items.contentCensorData) {
					console.log("Adding term " + items.contentCensorData[item].find);
					$(findBoxes[index]).val(items.contentCensorData[item].find);
					$(replaceBoxes[index]).val(items.contentCensorData[item].replace);
					$(checkBoxes[index]).prop("checked", items.contentCensorData[item].isRegex ? "checked" : "");
					index++;
				}
			});
		};
		var bindEvents = function() {
			$("#saveButton").click(function() {
				console.log("Saving");
				var findValues = $(".findField").map(function() {
					return $(this).val();
				});
				var replaceValues = $(".replaceField").map(function() {
					return $(this).val();
				});
				var isRegexValues = $("input[type=checkbox]").map(function() {
					return $(this).prop("checked") == true;
				});

				var structure = [];

				for (var i = 0; i < findValues.length; i++) {
					structure.push({
						find : findValues[i],
						replace : replaceValues[i],
						isRegex : isRegexValues[i]
					});
				};

				chrome.storage.sync.clear(function() {
					console.log("storage cleared");
					chrome.storage.sync.set({
						"contentCensorData" : structure
					}, function() {
						// Close the dialog.
						console.log("Save completed");
						window.close();
					});
				});
			});
		};

		that.init = function() {
			populateBoxes();
			bindEvents();
		};
		return that;
	})());

pageScripts.init();
