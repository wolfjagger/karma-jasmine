var formatFailedStep = function(step) {
  var stack   = step.stack;
  var message = step.message;

  if (stack) {
    // remove the trailing dot
    var firstLine = stack.substring(0, stack.indexOf('\n') - 1);

    if (message && message.indexOf(firstLine) === -1) {
      stack = message +'\n'+ stack;
    }

    // remove jasmine stack entries
    return stack.replace(/\n.+jasmine\.js\?\w*\:.+(?=(\n|$))/g, '');
  }

  return message;
};


var indexOf = function(collection, item) {
  if (collection.indexOf) {
    return collection.indexOf(item);
  }

  for (var i = 0, l = collection.length; i < l; i++) {
    if (collection[i] === item) {
      return i;
    }
  }

  return -1;
};


var SuiteNode = function(name, parent) {
  this.name = name;
  this.parent = parent;
  this.children = [];

  this.addChild = function(name) {
    var suite = new SuiteNode(name, this);
    this.children.push(suite);
    return suite;
  };
};


var getAllSpecNames = function(topSuite) {
  var specNames = {};

  function processSuite(suite, pointer) {
    var child;
    var childPointer;

    for (var i = 0; i < suite.children.length; i++) {
      child = suite.children[i];

      if (child.children) {
        childPointer = pointer[child.description] = {_: []};
        processSuite(child, childPointer);
      } else {
        if (!pointer._) {
          pointer._ = [];
        }
        pointer._.push(child.description);
      }
    }
  }

  processSuite(topSuite, specNames);

  return specNames;
};


/**
 * Very simple reporter for Jasmine.
 */
var KarmaReporter = function(tc, jasmineEnv) {

  /**
   * @param suite
   * @returns {boolean} Return true if it is system jasmine top level suite
   */
  var isTopLevelSuite = function (suite) {
    return suite.description === 'Jasmine_TopLevel_Suite';
  };

  var currentSuite = new SuiteNode();

  /**
   * Jasmine 2.0 dispatches the following events:
   *
   *  - jasmineStarted
   *  - jasmineDone
   *  - suiteStarted
   *  - suiteDone
   *  - specStarted
   *  - specDone
   */

  this.jasmineStarted = function(data) {
    // TODO(vojta): Do not send spec names when polling.
    tc.info({
      total: data.totalSpecsDefined,
      specs: getAllSpecNames(jasmineEnv.topSuite())
    });
  };


  this.jasmineDone = function() {
    tc.complete({
      coverage: window.__coverage__
    });
  };


  this.suiteStarted = function(result) {
    if (!isTopLevelSuite(result)) {
      currentSuite = currentSuite.addChild(result.description);
    }
  };


  this.suiteDone = function(result) {
    // In the case of xdescribe, only "suiteDone" is fired.
    // We need to skip that.
    if (result.description !== currentSuite.name) {
      return;
    }

    currentSuite = currentSuite.parent;
  };


  this.specStarted = function(specResult) {
    specResult.startTime = new Date().getTime();
  };


  this.specDone = function(specResult) {
    var skipped = specResult.status === 'disabled' || specResult.status === 'pending';

    var result = {
      description : specResult.description,
      id          : specResult.id,
      log         : [],
      skipped     : skipped,
      success     : specResult.failedExpectations.length === 0,
      suite       : [],
      time        : skipped ? 0 : new Date().getTime() - specResult.startTime
    };

    // generate ordered list of (nested) suite names
    var suitePointer = currentSuite;
    while (suitePointer.parent) {
      result.suite.unshift(suitePointer.name);
      suitePointer = suitePointer.parent;
    }

    if (!result.success) {
      var steps = specResult.failedExpectations;
      for (var i = 0, l = steps.length; i < l; i++) {
        result.log.push(formatFailedStep(steps[i]));
      }
    }

    tc.result(result);
    delete specResult.startTime;
  };
};

/**
 * Extract grep option from karma config
 * @param {[Array|string]} clientArguments The karma client arguments
 * @return {string} The value of grep option by default empty string
 */
var getGrepOption = function(clientArguments) {
  var clientArgString = clientArguments || '';

  if (Object.prototype.toString.call(clientArguments) === '[object Array]') {
    clientArgString = clientArguments.join('=');
  }

  var match = /--grep=(.*)/.exec(clientArgString);
  return match ? match[1] : '';
};

/**
 * Create jasmine spec filter
 * @param {Object} options Spec filter options
 */
var KarmaSpecFilter = function(options) {
  var filterString = options && options.filterString() && options.filterString().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  var filterPattern = new RegExp(filterString);

  this.matches = function(specName) {
    return filterPattern.test(specName);
  };
};

/**
 * @param {Object} config The karma config
 * @param {Object} jasmineEnv jasmine environment object
 */
var createSpecFilter = function(config, jasmineEnv) {
  var specFilter = new KarmaSpecFilter({
    filterString: function() {
      return getGrepOption(config.args);
    }
  });

  jasmineEnv.specFilter = function(spec) {
    return specFilter.matches(spec.getFullName());
  };
};

var createStartFn = function(tc, jasmineEnvPassedIn) {
  return function(config) {
    // we pass jasmineEnv during testing
    // in production we ask for it lazily, so that adapter can be loaded even before jasmine
    var jasmineEnv = jasmineEnvPassedIn || window.jasmine.getEnv();

    jasmineEnv.addReporter(new KarmaReporter(tc, jasmineEnv));
    jasmineEnv.execute();
  };
};
