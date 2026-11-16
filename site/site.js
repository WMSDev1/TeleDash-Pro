// Fills in this site's own addresses so the page works for any fork without a build step.
// GitHub Pages project sites live at https://<owner>.github.io/<repo>/.
(function () {
  "use strict";
  var base = location.origin + location.pathname.replace(/[^/]*$/, "");
  var repo = document.getElementById("repo-url");
  if (repo && /^https?:$/.test(location.protocol)) repo.textContent = base + "repo/apps.json";

  var m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  var docs = document.getElementById("docs-link");
  if (m && docs) {
    var first = location.pathname.split("/")[1];
    var name = first && first.indexOf(".") < 0 ? first : m[1] + ".github.io";   // user site: no repo segment
    docs.href = "https://github.com/" + m[1] + "/" + name + "/tree/main/docs";
  }
})();
