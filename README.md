# ContentCensor

## Overview
Content Censor is an extension for Chrome that provides replacement of visible text of a webpage using the browser's DOM engine and related eventing structure. This is now a Manifest V3 compliant extension. 


## Features

- Automatically backs up your subsitution preferences into browser storage.
- Supports an aribtarrily large set of replacment terms.
- Terms can be single words, whole phrases, or regex expressions.

## Installation

This can be installed via the Chrome Web Store (https://chromewebstore.google.com/detail/iaijmkccajdcoanhapmfihooogolkggi). To install from source:

1. Clone the repo.
1. Run the build script:
```shell
$ ./scripts/build.sh
```
1. The builder creates the `dist/` subdirectory. In Chrome, Open Settings->Manage Extensions and select "Developer Mode". 
1. Select "Load Unpacked"
1. Navigate to the `dist/` subdirectory. Chrome will load the extension from here.
