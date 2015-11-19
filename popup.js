var toReplace = [];
var replaceWith = [];
var validElements = ["tt",
"i",
"b",
"big",
"small",
"em",
"strong",
"dfn",
"code",
"samp",
"kbd",
"var",
"cite",
"abbr",
"acronym",
"sub",
"sup",
"span",
"bdo",
"address",
"div",
"a",
"p",
"h1", "h2", "h3", "h4", "h5", "h6",
"pre",
"q",
"ins",
"del",
"dt",
"dd",
"li",
"label",
"option",
"textarea",
"fieldset",
"legend",
"button",
"caption",
"td",
"th"];
var mutationObserver;

var replacementFn = function(parent) {
	var i;
	for (i = 0; i < parent.childNodes.length; i++) {
		replacementFn(parent.childNodes[i]);
	}
	if (parent.nodeType === parent.TEXT_NODE && validElements.indexOf(parent.parentElement.nodeName.toLowerCase()) > -1) {
  	for (i = 0; i < toReplace.length; i++) {
  	    if (parent) {
  			  parent.textContent = parent.textContent.replace(toReplace[i], replaceWith[i]);
  	    }
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

  mutationObserver = new MutationObserver(function(mutations){
    mutations.forEach(function(mutation){
      // if (validElements.indexOf(mutation.target.tagName.toLowerCase()) > -1){
        replacementFn(mutation.target);
      // }
    });
  });
  	
  mutationObserver.observe(document.body, {childList: true, subtree: true, characterData: true});
});