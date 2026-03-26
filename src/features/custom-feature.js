/*EXPLANATION
---------------------------------------------
CUSTOM FEATURE TO WORK WITH BARBA BOILERPLATE
---------------------------------------------

STEP 1: ADD CONTAINER TO THE FUNCTION TO SCOPE THE FEATURE TO THE INCOMING PAGE
e.g. function initCustomFeature( --> container <-- )
---------------------------------------------

STEP 2: SCOPE THE CONTAINER TO EITHER CONTAINER FROM BOILERPLATE, OR TO DOCUMENT FOR FIRST INIT
e.g. container = container || document;
---------------------------------------------

STEP 3: CHANGE DOCUMENT TO CONTAINER FOR INITIAL SCOPE
e.g. const inits = container.querySelectorAll('[data-custom-feature]');
---------------------------------------------

STEP 4: WRAP INIT-FUNCTION INTO AN EXPORT-FUNCTION
e.g. 
function customFeature() {
  initCustomFeature();
 }
export default customFeature;
---------------------------------------------


STEP 5: DISPATCH THE FUNCTION TO THE enterAfterFunction IN THE BOILERPLATE
e.g.
function customFeature() {
  
  | document.addEventListener('barba:afterEnter', (e) => {
  |   initCustomFeature(e.detail.container);
  | });
}
export default customFeature;
---------------------------------------------

STEP 6: ADD THE FEATURE TO THE CONFIG.JS AND MAIN.JS

*********************************************
*/



//boilerplate - add container to the function to scope the feature to the incoming page
function initCustomFeature(container) {
  //boilerplate - if no container is provided, use the document
  container = container || document;
  //boilerplate - change document to container for initial scope
  const inits = container.querySelectorAll('[data-custom-feature]');
  if (!inits.length) return;

  inits.forEach(customLog);

  function customLog(init) {
    console.log("this is soooo custom");
  }
}

function customFeature() {
  //boilerplate - dispatch to the EnterAfterFunction
  document.addEventListener('barba:afterEnter', (e) => {
    initCustomFeature(e.detail.container);
  });
}

export default customFeature;