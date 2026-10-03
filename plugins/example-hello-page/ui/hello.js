// The page's only behaviour: the button writes the greeting.
document.getElementById("hello").addEventListener("click", () => {
  document.getElementById("greeting").textContent = "Hello World";
});
