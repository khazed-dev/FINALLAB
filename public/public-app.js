const pingButton = document.getElementById("pingButton");
const pingResult = document.getElementById("pingResult");

if (pingButton) {
  pingButton.addEventListener("click", async () => {
    pingButton.disabled = true;
    pingResult.textContent = "Checking...";

    try {
      const response = await fetch("/api/ping");
      const data = await response.json();
      pingResult.textContent = `${data.message} @ ${new Date(data.time).toLocaleTimeString()}`;
    } catch (error) {
      pingResult.textContent = "Ping failed";
    } finally {
      pingButton.disabled = false;
    }
  });
}
