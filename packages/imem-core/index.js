// IMEM Core — shared engine for IncretinAi app & Telegram bot
module.exports = {
  ...require('./calculate'),
  ...require('./biosync'),
  ...require('./score'),
  ...require('./prediction'),
  ...require('./context-builder'),
  ...require('./meal-utils'),
  ...require('./interpret'),
  ...require('./normalize'),
  constants: require('./constants'),
  schema: require('./schema'),
};
