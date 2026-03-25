const pingButton = document.getElementById("pingButton");
const pingResult = document.getElementById("pingResult");

if (pingButton) {
  pingButton.addEventListener("click", async () => {
    pingButton.disabled = true;
    pingResult.textContent = "Đang kiểm tra...";

    try {
      const response = await fetch("/api/ping");
      const data = await response.json();
      pingResult.textContent = `${data.message} lúc ${new Date(data.time).toLocaleTimeString("vi-VN")}`;
    } catch (error) {
      pingResult.textContent = "Ping thất bại";
    } finally {
      pingButton.disabled = false;
    }
  });
}
