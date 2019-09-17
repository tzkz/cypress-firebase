describe('Projects View', () => {
  before(() => {
    // Go to home page
    cy.visit('/');
  });
  
  describe('when not authenticated', () => {
    it('Shows projects', () => {
      cy.get('[data-test=projects]').click()
    });
  })
});
