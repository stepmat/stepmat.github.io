(function () {
  "use strict";

  var programEl = document.getElementById("program");
  var consultStatus = document.getElementById("consult-status");
  var queryEl = document.getElementById("query");
  var queryRunBtn = document.getElementById("query-run-btn");
  var resultsEl = document.getElementById("results");
  var exampleSelect = document.getElementById("example-select");

  // Tau Prolog comes from a CDN; without it nothing on the page can work, so say so.
  if (typeof pl === "undefined") {
    setStatus("The Prolog engine (Tau Prolog) failed to load, so queries can't run. " +
      "Check your internet connection and reload the page.", "err");
    queryRunBtn.disabled = true;
    return;
  }

  var session = pl.create(20000);

  var EXAMPLES = {
    food:
      "italian(pizza).\n" +
      "indian(curry).\n" +
      "chinese(dumplings).\n" +
      "german(sausage).\n\n" +
      "spicy(X) :- indian(X).\n" +
      "likes(sam, X) :- spicy(X).\n\n" +
      "european(X) :- italian(X); german(X).\n" +
      "asian(X) :- indian(X); chinese(X).\n",
    family:
      "parent(bill, eve).\n" +
      "parent(jane, eve).\n" +
      "parent(eve, pete).\n" +
      "parent(bill, sarah).\n" +
      "parent(tom, lucy).\n" +
      "parent(eve, ann).\n" +
      "parent(fred, pete).\n" +
      "parent(fred, ann).\n" +
      "parent(jane, tom).\n\n" +
      "female(ann).\n" +
      "female(eve).\n" +
      "female(jane).\n" +
      "female(sarah).\n" +
      "female(lucy).\n" +
      "male(bill).\n" +
      "male(pete).\n" +
      "male(fred).\n" +
      "male(tom).\n\n" +
      "grandparent(X,Y) :- parent(X,Z), parent(Z,Y).\n" +
      "father(X,Y) :- parent(X,Y), male(X).\n" +
      "mother(X,Y) :- parent(X,Y), female(X).\n" +
      "sibling(X,Y) :- parent(Z,X), parent(Z,Y).\n" +
      "uncle(X,Y) :- parent(Z,Y), sibling(X,Z), male(X).\n"
  };

  exampleSelect.addEventListener("change", function () {
    var key = exampleSelect.value;
    if (key && EXAMPLES[key]) {
      // Only ask when loading would throw away the user's own text: an empty box or
      // an unedited example is replaced without a prompt.
      var current = programEl.value.trim();
      var isUnchangedExample = Object.keys(EXAMPLES).some(function (k) {
        return EXAMPLES[k].trim() === current;
      });
      if (current && !isUnchangedExample &&
          !window.confirm("Replace the current knowledge base with this example? Your changes will be lost.")) {
        exampleSelect.value = "";
        return;
      }
      programEl.value = EXAMPLES[key];
      setStatus("Example loaded.", "");
    }
    exampleSelect.value = "";
  });

  function setStatus(msg, cls) {
    consultStatus.textContent = msg;
    consultStatus.className = "status" + (cls ? " " + cls : "");
  }

  function addResult(text, cls) {
    var div = document.createElement("div");
    div.className = "answer " + (cls || "");
    div.textContent = text;
    resultsEl.appendChild(div);
    resultsEl.scrollTop = resultsEl.scrollHeight;
  }

  function clearResults() {
    resultsEl.innerHTML = "";
  }

  // Tau Prolog reports syntax errors as
  //   error(syntax_error(MESSAGE),[line(L),column(C),found(TOKEN)])
  // where MESSAGE may itself contain commas and brackets (e.g. ", or ) expected"),
  // TOKEN may be a bracket, and found(...) is replaced by token_not_found at end of input.
  // Columns are 0-based. showLine is for the knowledge base; a query is always one line.
  function describeSyntaxError(raw, showLine) {
    var m = raw.match(/syntax_error\((.*)\),\[line\((\d+)\),column\((\d+)\),(?:found\((.*)\)|token_not_found)\]\)\s*$/);
    if (!m) return null;
    var message = m[1];
    var line = Number(m[2]);
    var column = Number(m[3]) + 1;
    var found = m[4];

    // ". or operator expected" -> "expected '.' or an operator"
    var expected = message.match(/^(.*) expected$/);
    if (expected) {
      message = "expected " + expected[1].split(" or ").map(function (part) {
        if (part === "operator") return "an operator";
        return /^[^\w\s]$/.test(part) ? "'" + part + "'" : part;
      }).join(" or ");
    }

    var where = showLine ? "line " + line + ", column " + column : "column " + column;
    var detail;
    if (expected) {
      detail = message + ", but " + (found === undefined ? "reached the end of the input" : "found '" + found + "'");
    } else {
      detail = message + (found === undefined ? " at the end of the input" : " '" + found + "'");
    }
    return "Syntax error at " + where + ": " + detail + ". Check for a missing full stop, comma or bracket.";
  }

  function friendlyError(err, inKnowledgeBase) {
    var raw = session.format_answer(err);
    var match;

    match = raw.match(/existence_error\(procedure,\s*([^)]+)\)/);
    if (match) {
      return "Unknown predicate " + match[1] + " — check it is spelled correctly and defined in your program.";
    }

    var syntax = describeSyntaxError(raw, inKnowledgeBase);
    if (syntax) return syntax;

    match = raw.match(/type_error\(([^,]+),\s*([^)]+)\)/);
    if (match) {
      return "Type error: expected " + match[1] + " but got " + match[2] + ".";
    }

    match = raw.match(/instantiation_error/);
    if (match) {
      return "Instantiation error: a variable needs a value before this can be evaluated.";
    }

    return raw;
  }

  // Tau Prolog delivers answers asynchronously, so a query can still be producing
  // answers when the next one starts. Each query gets its own number, and callbacks
  // from a query that has since been replaced are ignored: otherwise its last answer
  // appeared among the new query's results, and its answer loop carried on pulling
  // answers from the new query's session.
  var currentRun = 0;

  function runQuery() {
    var q = queryEl.value.trim();
    if (!q) return;
    if (!q.endsWith(".")) q += ".";

    clearResults();
    setStatus("", "");

    var run = ++currentRun;
    var querySession = pl.create(20000);
    session = querySession;
    querySession.consult(programEl.value, {
      // Always treat the box's contents as program text. By default Tau Prolog first
      // tries a whitespace-free string as a URL (and as a script element id), so a
      // one-line program like "italian(pizza)." fired a request to the server, and one
      // matching a real file (e.g. "style.css") was silently replaced by that file.
      url: false,
      script: false,
      file: false,
      success: function () {
        if (run !== currentRun) return;
        querySession.query(q, {
          success: function () {
            if (run === currentRun) askAll(querySession, run);
          },
          error: function (err) {
            if (run === currentRun) addResult(friendlyError(err), "error");
          }
        });
      },
      error: function (err) {
        if (run === currentRun) setStatus("Error in knowledge base: " + friendlyError(err, true), "err");
      }
    });
  }

  var MAX_ANSWERS = 500;

  function askAll(querySession, run) {
    var count = 0;

    function next(isFirst) {
      if (run !== currentRun) return;
      if (count >= MAX_ANSWERS) {
        addResult("-- answer limit reached --", "info");
        return;
      }
      querySession.answer({
        success: function (answer) {
          if (run !== currentRun) return;
          count++;
          var text = querySession.format_answer(answer);
          if (text === "true" || text === "true.") {
            addResult("true.", "true");
          } else {
            addResult(text, "true");
            next(false);
          }
        },
        error: function (err) {
          if (run === currentRun) addResult(friendlyError(err), "error");
        },
        fail: function () {
          if (run === currentRun && isFirst) addResult("false.", "false");
        },
        limit: function () {
          if (run === currentRun) addResult("-- resource limit exceeded --", "error");
        }
      });
    }

    next(true);
  }

  queryRunBtn.addEventListener("click", runQuery);
  queryEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") runQuery();
  });
})();
